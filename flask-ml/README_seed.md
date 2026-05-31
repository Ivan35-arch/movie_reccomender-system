Seeding movies and initializing Azure PostgreSQL
=============================================

1) Create an Azure PostgreSQL Flexible Server and note the connection info.

2) Add your server to Azure firewall rules so your client IP (or Render/Vercel IPs) can connect.

3) Run the initialization SQL (`init.sql`) to create tables.

Example using `psql` (replace `your-server` with your Azure host):

```bash
export PGPASSWORD="@hazardkid10"
psql "host=your-server.postgres.database.azure.com port=5432 dbname=movie_db user=movie_login@your-server sslmode=require" -f init.sql
```

Or using `psql` with `DATABASE_URL` (URL-encode special characters in the password, e.g. `@` -> `%40`):

```bash
# Example with password containing @ encoded as %40
export DATABASE_URL="postgres://movie_login:%40hazardkid10@your-server.postgres.database.azure.com:5432/movie_db?sslmode=require"
psql "$DATABASE_URL" -f init.sql
```

4) Set env vars for seeding and run the Python script (uses `DATABASE_URL` or `DB_*` vars):

```bash
export TMDB_API_KEY="e70edc2a521877e9b3d1c03ecd2564fe"
export DATABASE_URL="postgres://movie_login:%40hazardkid10@your-server.postgres.database.azure.com:5432/movie_db?sslmode=require"
python flask-ml/scripts/seed_movies.py --movies "C:/Users/USER/Desktop/projects/Certificates for data analysis/ml-latest-small/ml-latest-small/movies.csv" --links "C:/Users/USER/Desktop/projects/Certificates for data analysis/ml-latest-small/ml-latest-small/links.csv"
```

Notes:
- Do NOT commit `TMDB_API_KEY`, `DATABASE_URL`, or `flask-ml/.env` with real credentials into version control. Use environment/secret stores in your deployment platform.
- The seeder uses `ON CONFLICT DO NOTHING` for `movies.id` so it is safe to re-run.
- If running from CI or a remote host, ensure the runner's IP is allowed in the Azure firewall, or run the seeder from a machine allowed by the server.
- If your password contains special characters, URL-encode them when building `DATABASE_URL` (e.g. `@` -> `%40`).
