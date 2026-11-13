
const { Client } = require('@elastic/elasticsearch');

const {
  ELASTICSEARCH_URL,
  ELASTICSEARCH_API_KEY
} = process.env;

if (!ELASTICSEARCH_URL || !ELASTICSEARCH_API_KEY) {
  throw new Error(
    'Elasticsearch URL or API key is missing from .env'
  );
}

const elasticClient = new Client({
  node: ELASTICSEARCH_URL,
  auth: {
    apiKey: ELASTICSEARCH_API_KEY
  }
});

module.exports = elasticClient;
