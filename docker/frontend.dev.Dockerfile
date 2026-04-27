# docker/frontend.dev.Dockerfile — Development only
# Runs the Vite dev server with HMR. Not used in production.

FROM node:22-alpine
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
