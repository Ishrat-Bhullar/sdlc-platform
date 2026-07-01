const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'EY Autonomous SDLC Studio API',
      version: '1.0.0',
      description: 'Backend API for EY AI Agent Platform — Authentication, Projects, Agents, Requirements, Architecture, Database, Code Generation & Governance',
    },
    servers: [
      { url: 'http://localhost:8000', description: 'Development server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);