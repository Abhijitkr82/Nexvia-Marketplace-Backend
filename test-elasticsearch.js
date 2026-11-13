require('dotenv').config();

const elasticClient = require('./config/elasticsearch');

async function testElasticsearch() {
  try {
    const response = await elasticClient.info();

    console.log('✅ Elasticsearch Connected Successfully!');
    console.log('Cluster:', response.cluster_name);
    console.log('Version:', response.version.number);
  } catch (error) {
    console.error('❌ Elasticsearch Connection Failed:', error.message);
  }
}

testElasticsearch();