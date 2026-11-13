# Nexvia Marketplace — Backend

Backend API for **Nexvia**, a multi-vendor e-commerce marketplace built with Node.js, Express and MongoDB.

## Tech Stack

- Node.js and Express.js
- MongoDB with Mongoose
- Redis
- Elasticsearch
- AWS S3
- Razorpay Payment Gateway
- JWT Authentication
- bcryptjs Password Hashing

## Features

- User authentication and role-based access
- Customer, Vendor and Admin functionality
- Product management and product search
- Shopping cart and coupon management
- Order management and checkout
- Razorpay payment integration and Cash on Delivery
- Product reviews
- Vendor payouts
- Image uploads using AWS S3
- Elasticsearch-powered product search

## Requirements

Before running the backend, make sure you have:

- Node.js 20.19+ or 22.12+
- npm
- MongoDB database
- Redis instance
- Elasticsearch endpoint and API key
- AWS S3 bucket and credentials
- Razorpay API credentials

## Installation

Clone the repository:

```bash
git clone https://github.com/Abhijitkr82/Nexvia-Marketplace-Backend.git
```

Move into the project directory:

```bash
cd Nexvia-Marketplace-Backend
```

Install dependencies:

```bash
npm ci
```

## Environment Configuration

Create a `.env` file in the backend root directory.

Use `.env.example` as a reference and configure your own credentials.

Required configuration includes:

- MongoDB connection
- JWT secret
- Redis credentials
- Elasticsearch credentials
- AWS S3 credentials
- Razorpay API credentials

**Never commit your actual `.env` file or expose private credentials.**

## Run Locally

Before starting the backend in PowerShell, run:

```powershell
$env:NODE_OPTIONS="--require ./dns-fix.cjs"
```

This preloads the project's DNS configuration fix for Node.js.

Start the development server:

```bash
npm run dev
```

Or start the backend normally:

```bash
npm start
```

Run the DNS command again whenever you open a new PowerShell terminal before starting the backend.

The backend runs on:

```text
http://localhost:5000
```

API routes are available under:

```text
http://localhost:5000/api
```

The root endpoint is:

```text
http://localhost:5000/
```

## Create an Admin Account

After configuring the environment variables, run:

```bash
node create-admin.js
```

Follow the prompts to enter:

- Admin name
- Admin email
- Strong admin password (minimum 12 characters)

The script securely hashes the password before saving the admin account.

## Available Scripts

| Command | Description |
|---|---|
| `npm start` | Starts the backend |
| `npm run dev` | Starts the backend with Nodemon |

## Deployment

For production deployment:

- Install command: `npm ci`
- Start command: `npm start`
- Configure all required environment variables in the hosting provider.
- Ensure MongoDB, Redis and Elasticsearch are accessible from the backend.
- Configure the frontend API URL to point to the deployed backend.

Keep all private credentials on the backend. Never expose JWT secrets, AWS credentials or Razorpay secret keys in frontend code.

## Security Notes

- Do not commit `.env` files.
- Use strong JWT secrets and admin passwords.
- Keep AWS and Razorpay credentials private.
- Use Razorpay test credentials during development.
- Configure production credentials securely before deployment.

## Repository

GitHub: https://github.com/Abhijitkr82/Nexvia-Marketplace-Backend

---

**Nexvia Marketplace Backend**