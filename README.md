# Nexvia Marketplace — Backend

Express, MongoDB, Redis, Elasticsearch, AWS S3 and Razorpay API for the Nexvia multi-vendor marketplace.

## Requirements

- Node.js 20.19+ or 22.12+
- MongoDB connection string
- Redis instance
- Elasticsearch endpoint and API key
- AWS S3 bucket and credentials
- Razorpay test/live API credentials

## Environment variables

Create a `.env` file in the backend root. Configure the values in your deployment provider's secret/environment settings; do not commit real credentials.

```env
PORT=5000
MONGO_URI=
JWT_SECRET=

REDIS_HOST=
REDIS_PORT=
REDIS_PASSWORD=

ELASTICSEARCH_URL=
ELASTICSEARCH_API_KEY=
ELASTICSEARCH_INDEX=products

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_S3_BUCKET=

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
```

## Install and run locally

```bash
npm ci
npm run dev
```

Production start:

```bash
npm start
```

The API is mounted under `/api`. The root health response is available at `/`.

## Deployment

- Build/install command: `npm ci`
- Start command: `npm start`
- Set every required environment variable in the hosting provider.
- Ensure MongoDB, Redis and Elasticsearch are reachable from the backend host.
- Configure the frontend `VITE_API_URL` as `https://YOUR-BACKEND-DOMAIN/api`.
- Keep Razorpay keys, JWT secret and AWS credentials only on the backend.

## Important

The server startup connects to MongoDB and Redis before listening. A missing or unreachable MongoDB/Redis service prevents startup. Elasticsearch credentials are validated when the Elasticsearch client module loads.
