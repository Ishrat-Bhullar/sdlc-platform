const express = require('express');
const { authenticate } = require('../middleware/auth');
const documentsController = require('../controllers/documentsController');

const router = express.Router();
router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Documentation
 *   description: Documentation portal management
 */

// Export/static routes first (avoid :id shadowing)
router.get('/documents/export-all', documentsController.exportAllDocuments);
router.get('/documents/export-artifact', documentsController.exportGeneratedArtifact);

// Document collection route
router.get('/documents', documentsController.listDocuments);
router.post('/documents', documentsController.createDocument);

// Version history and ID-specific routes
router.get('/documents/:id/versions', documentsController.getDocumentVersions);
router.get('/documents/:id/export/:format', documentsController.exportDocument);
router.get('/documents/:id', documentsController.getDocument);
router.put('/documents/:id', documentsController.updateDocument);
router.delete('/documents/:id', documentsController.deleteDocument);

module.exports = router;
