
clean:
	@bun run clean

dev:
	@docker compose up -d redis
	@docker compose up -d postgres

	# Set up tmux environment
	./setup_devenv.sh

	# Run commands
	@tmux send-keys -t kongdevenv:0.0 'PORT=$${PORT:-3001} bun --filter web dev' C-m
	@tmux send-keys -t kongdevenv:0.1 'bun --filter ingest dev' C-m
	@tmux send-keys -t kongdevenv:0.2 'bun --filter terminal dev' C-m
	@tmux send-keys -t kongdevenv:0.3 'sleep 6 && bun --filter db migrate up && PGPASSWORD=password psql --host=localhost --port=5432 --username=user --dbname=user' C-m

	@tmux selectp -t 2
	@tmux attach-session -t kongdevenv

	# This happens when tmux session ends
	@docker compose down

test:
	@bun run test

down:
	@docker compose down
	-@tmux kill-session -t kongdevenv
