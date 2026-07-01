const { query } = require('../config/database');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun } = require('docx');

const listDocuments = async (req, res, next) => {
  try {
    const { projectId, docType, search } = req.query;
    const params = [];
    let sql = 'SELECT * FROM documents WHERE 1=1';
    if (projectId) { params.push(projectId); sql += ` AND project_id = $${params.length}`; }
    if (docType) { params.push(docType); sql += ` AND doc_type = $${params.length}`; }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (title ILIKE $${params.length} OR content ILIKE $${params.length})`;
    }
    sql += ' ORDER BY created_at DESC';
    const result = await query(sql, params);
    res.json({ documents: result.rows });
  } catch (err) {
    next(err);
  }
};

const getDocument = async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Document not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const createDocument = async (req, res, next) => {
  try {
    const { projectId, docType, title, content, fileFormat } = req.body;
    if (!projectId || !docType || !title) {
      return res.status(400).json({ error: 'ValidationError', message: 'projectId, docType, and title are required' });
    }
    const result = await query(
      `INSERT INTO documents (project_id, doc_type, title, content, file_format) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [projectId, docType, title, content || '', fileFormat || 'json']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const updateDocument = async (req, res, next) => {
  try {
    const { title, content, docType, fileFormat } = req.body;
    const result = await query(
      `UPDATE documents SET title = COALESCE($1, title), content = COALESCE($2, content), doc_type = COALESCE($3, doc_type), file_format = COALESCE($4, file_format), updated_at = NOW() WHERE id = $5 RETURNING *`,
      [title, content, docType, fileFormat, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Document not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

const deleteDocument = async (req, res, next) => {
  try {
    const result = await query('DELETE FROM documents WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Document not found' });
    res.json({ message: 'Deleted', id: req.params.id });
  } catch (err) {
    next(err);
  }
};

const getDocumentVersions = async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM documents WHERE project_id = (SELECT project_id FROM documents WHERE id = $1) AND doc_type = (SELECT doc_type FROM documents WHERE id = $1) ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json({ versions: result.rows });
  } catch (err) {
    next(err);
  }
};

const exportDocument = async (req, res, next) => {
  try {
    const { format } = req.params;
    const result = await query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'NotFound', message: 'Document not found' });
    const doc = result.rows[0];
    let mimeType = 'application/json';
    let filename = `${doc.title || 'document'}.${format}`;
    let content = doc.content || '';
    if (format === 'json') {
      mimeType = 'application/json';
    } else if (format === 'md' || format === 'markdown') {
      mimeType = 'text/markdown';
      filename = `${doc.title || 'document'}.md`;
    } else if (format === 'pdf') {
      mimeType = 'application/pdf';
      filename = `${doc.title || 'document'}.pdf`;
    } else if (format === 'docx') {
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      filename = `${doc.title || 'document'}.docx`;
    } else {
      return res.status(400).json({ error: 'ValidationError', message: 'Unsupported format' });
    }
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err) {
    next(err);
  }
};

const exportAllDocuments = async (req, res, next) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'ValidationError', message: 'projectId is required' });
    const result = await query('SELECT * FROM documents WHERE project_id = $1 ORDER BY created_at DESC', [projectId]);
    const docs = result.rows;
    const exportData = docs.map(doc => ({
      id: doc.id,
      doc_type: doc.doc_type,
      title: doc.title,
      content: doc.content,
      file_format: doc.file_format,
      created_at: doc.created_at,
    }));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="documents_${projectId}.json"`);
    res.json(exportData);
  } catch (err) {
    next(err);
  }
};

const exportGeneratedArtifact = async (req, res, next) => {
  try {
    const { projectId, artifact_type, format = 'json' } = req.query;
    if (!projectId || !artifact_type) {
      return res.status(400).json({ error: 'ValidationError', message: 'projectId and artifact_type are required' });
    }

    const artifactResult = await query(
      `SELECT id, artifact_type, content, created_at
       FROM generated_artifacts
       WHERE project_id = $1 AND artifact_type = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [projectId, artifact_type]
    );

    if (!artifactResult.rows.length) {
      return res.status(404).json({ error: 'NotFound', message: 'No artifacts found' });
    }

    const artifact = artifactResult.rows[0];
    const rawContent = artifact.content || '';
    let parsedContent = rawContent;
    try {
      parsedContent = JSON.parse(rawContent);
    } catch (_) {
      // keep string
    }

    const markdownContent =
      typeof parsedContent === 'string'
        ? parsedContent
        : `# ${artifact_type}\n\n\`\`\`json\n${JSON.stringify(parsedContent, null, 2)}\n\`\`\`\n`;

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${artifact_type}_${artifact.id}.json"`);
      return res.send(typeof parsedContent === 'string' ? parsedContent : JSON.stringify(parsedContent, null, 2));
    }

    if (format === 'md' || format === 'markdown') {
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', `attachment; filename="${artifact_type}_${artifact.id}.md"`);
      return res.send(markdownContent);
    }

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${artifact_type}_${artifact.id}.pdf"`);

      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      doc.pipe(res);
      doc.fontSize(18).text(`Artifact: ${artifact_type}`, { underline: true });
      doc.moveDown();
      doc.fontSize(10).text(markdownContent);
      doc.end();
      return;
    }

    if (format === 'docx') {
      const lines = markdownContent.split('\n');
      const paragraphs = lines.map((line) =>
        new Paragraph({
          children: [new TextRun({ text: line || ' ' })],
        })
      );

      const document = new Document({
        sections: [{ properties: {}, children: paragraphs }],
      });

      const buffer = await Packer.toBuffer(document);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${artifact_type}_${artifact.id}.docx"`);
      return res.send(buffer);
    }

    return res.status(400).json({ error: 'ValidationError', message: 'Unsupported format' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  getDocumentVersions,
  exportDocument,
  exportAllDocuments,
  exportGeneratedArtifact,
};
