#!/bin/bash

# Check if the tmux session 'kongdevenv' already exists
tmux has-session -t kongdevenv 2>/dev/null

if ! tmux has-session -t kongdevenv 2>/dev/null; then
  echo "Creating new tmux session: kongdevenv"
  tmux new-session -d -s kongdevenv
  
  tmux splitw -v -l 50% -t kongdevenv
  tmux selectp -t 0
  tmux splitw -h -l 80% -t kongdevenv
  tmux selectp -t 2
  tmux splitw -h -l 50% -t kongdevenv
else
  echo "Using existing 'kongdevenv' tmux session."
fi
