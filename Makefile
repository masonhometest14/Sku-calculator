.PHONY: install backend-install frontend-install backend frontend

install: backend-install frontend-install

backend-install:
	cd backend && npm ci

frontend-install:
	cd frontend && npm ci

backend:
	cd backend && npm start

frontend:
	cd frontend && npm run dev

dev: backend frontend