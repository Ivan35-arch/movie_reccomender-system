#!/usr/bin/env bash
set -e

echo "Fetching a movie..."
movie_json=$(curl -s "http://localhost:3000/api/movies?page=1&per_page=1")
echo "$movie_json"
movie_id=$(echo "$movie_json" | python -c "import sys,json; d=json.load(sys.stdin); print(d['movies'][0]['id'])")
echo "movie_id=$movie_id"
if [ -z "$movie_id" ] || [ "$movie_id" = "0" ]; then echo "No movie id found"; exit 1; fi

tmp=/tmp/sse_out.txt
# Start SSE capture in background for 12s
timeout 12s curl -s -N "http://localhost:3000/sse/notifications?user_id=1" > $tmp 2>/dev/null &
sse_pid=$!
sleep 1

echo "Posting rating..."
curl -s -X POST -H "Content-Type: application/json" -d "{\"user_id\":1,\"movie_id\":$movie_id,\"rating\":5}" http://localhost:3000/api/ratings | python -m json.tool || true

sleep 4

echo -e "\nSSE output:\n"
if [ -f $tmp ]; then cat $tmp; else echo "(no sse output file)"; fi

echo -e "\nLatest recommendations (express):"
curl -s "http://localhost:3000/api/recommendations/latest?user_id=1" | python -m json.tool || true

echo -e "\nFlask recommendations (direct):"
curl -s "http://localhost:5000/api/recommend/1?top_n=5" | python -m json.tool || true

echo -e "\n== Express logs =="
docker logs --tail 200 movie_reccomender-system-2-express-1 || true

echo -e "\n== Flask logs =="
docker logs --tail 200 movie_reccomender-system-2-flask-1 || true
