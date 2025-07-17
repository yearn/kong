

clean:
	@bun clean

dev:
	@docker compose up -d redis
	@docker compose up -d postgres

	# Set up tmux environment
	./setup_devenv.sh

	# Run commands
	@tmux send-keys -t kongdevenv:0.0 '(cd packages/web && PORT=$${PORT:-3001} bun dev)' C-m
	@tmux send-keys -t kongdevenv:0.1 '(cd packages/ingest && bun dev)' C-m
	@tmux send-keys -t kongdevenv:0.2 '(cd packages/terminal && bun dev)' C-m
	@tmux send-keys -t kongdevenv:0.3 'sleep 6 && (cd packages/db && bun migrate up) && PGPASSWORD=password psql --host=localhost --port=5432 --username=user --dbname=user' C-m

	@tmux selectp -t 2
	@tmux attach-session -t kongdevenv

	# This happens when tmux session ends
	@docker compose down

test:
	@yarn workspace lib test
	@yarn workspace ingest test


down:
	@docker compose down
	-@tmux kill-session -t kongdevenv
