const express = require('express');
const { body, validationResult } = require('express-validator');
const Session = require('../models/Session');
const { authenticateToken } = require('../middleware/auth');
const { generateNotes } = require('../utils/noteGenerator');

const router = express.Router();

// Validation rules
const createSessionValidation = [
  body('title')
    .notEmpty()
    .withMessage('Session title is required')
    .isLength({ max: 200 })
    .withMessage('Title cannot exceed 200 characters'),
  body('description')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Description cannot exceed 1000 characters'),
];

const addContentValidation = [
  body('data')
    .notEmpty()
    .withMessage('Content data is required'),
  body('type')
    .optional()
    .isIn(['text', 'screenshot', 'note', 'screen_capture'])
    .withMessage('Invalid content type'),
  body('topicTags')
    .optional()
    .isArray()
    .withMessage('Topic tags must be an array'),
  body('importance')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Importance must be between 1 and 5'),
];

// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  }
  next();
};

// POST /api/sessions/clear-active - Clear any active sessions for user
router.post('/clear-active', authenticateToken, async (req, res) => {
  try {
    await Session.updateMany(
      {
        userId: req.user.id,
        status: 'active',
        isActive: true,
      },
      {
        status: 'completed',
        endTime: new Date(),
      }
    );
    
    res.json({
      success: true,
      message: 'Active sessions cleared',
    });
  } catch (error) {
    console.error('Error clearing active sessions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear active sessions',
      error: error.message,
    });
  }
});

// POST /api/sessions - Create new session
router.post('/', authenticateToken, createSessionValidation, handleValidationErrors, async (req, res) => {
  try {
    const { title, description, settings } = req.body;
    
    // Check if user already has an active session
    const activeSession = await Session.getActiveSession(req.user.id);
    if (activeSession) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active session',
        session: activeSession,
      });
    }
    
    const session = new Session({
      userId: req.user.id,
      title,
      description,
      settings: {
        autoCapture: true,
        captureInterval: 30,
        noteGeneration: true,
        exportFormats: ['markdown', 'pdf', 'txt'],
        ...settings,
      },
    });
    
    await session.save();
    
    res.status(201).json({
      success: true,
      message: 'Session created successfully',
      session,
    });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create session',
      error: error.message,
    });
  }
});

// GET /api/sessions/active - Get active session
router.get('/active', authenticateToken, async (req, res) => {
  try {
    const session = await Session.getActiveSession(req.user.id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'No active session found',
      });
    }
    
    res.json({
      success: true,
      session,
    });
  } catch (error) {
    console.error('Error fetching active session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active session',
      error: error.message,
    });
  }
});

// POST /api/sessions/:id/content - Add content to session
router.post('/:id/content', authenticateToken, addContentValidation, handleValidationErrors, async (req, res) => {
  try {
    const { data, type, topicTags, importance } = req.body;
    
    const session = await Session.findOne({
      _id: req.params.id,
      userId: req.user.id,
      isActive: true,
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }
    
    if (session.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Session is not active',
      });
    }
    
    await session.addContent({
      data,
      type,
      topicTags,
      importance,
    });
    
    res.json({
      success: true,
      message: 'Content added successfully',
      session,
    });
  } catch (error) {
    console.error('Error adding content:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add content',
      error: error.message,
    });
  }
});

// POST /api/sessions/:id/end - End session and generate notes
router.post('/:id/end', authenticateToken, async (req, res) => {
  try {
    const session = await Session.findOne({
      _id: req.params.id,
      userId: req.user.id,
      isActive: true,
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }
    
    if (session.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Session is already ended',
      });
    }
    
    // End the session
    await session.endSession();
    
    // Generate notes if enabled
    if (session.settings.noteGeneration && session.content.length > 0) {
      try {
        const notes = await generateNotes(session.content);
        session.generatedNotes = notes;
        await session.save();
      } catch (noteError) {
        console.error('Error generating notes:', noteError);
        // Continue even if note generation fails
      }
    }
    
    res.json({
      success: true,
      message: 'Session ended successfully',
      session,
    });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to end session',
      error: error.message,
    });
  }
});

// POST /api/sessions/:id/pause - Pause session
router.post('/:id/pause', authenticateToken, async (req, res) => {
  try {
    const session = await Session.findOne({
      _id: req.params.id,
      userId: req.user.id,
      isActive: true,
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }
    
    if (session.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Session is not active',
      });
    }
    
    session.status = 'paused';
    await session.save();
    
    res.json({
      success: true,
      message: 'Session paused successfully',
      session,
    });
  } catch (error) {
    console.error('Error pausing session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to pause session',
      error: error.message,
    });
  }
});

// POST /api/sessions/:id/resume - Resume session
router.post('/:id/resume', authenticateToken, async (req, res) => {
  try {
    const session = await Session.findOne({
      _id: req.params.id,
      userId: req.user.id,
      isActive: true,
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }
    
    if (session.status !== 'paused') {
      return res.status(400).json({
        success: false,
        message: 'Session is not paused',
      });
    }
    
    session.status = 'active';
    await session.save();
    
    res.json({
      success: true,
      message: 'Session resumed successfully',
      session,
    });
  } catch (error) {
    console.error('Error resuming session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resume session',
      error: error.message,
    });
  }
});

// GET /api/sessions - Get session history
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { limit = 10, page = 1 } = req.query;
    const skip = (page - 1) * limit;
    
    const sessions = await Session.getSessionHistory(req.user.id, parseInt(limit))
      .skip(skip);
    
    const total = await Session.countDocuments({
      userId: req.user.id,
      status: 'completed',
      isActive: true,
    });
    
    res.json({
      success: true,
      sessions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching session history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session history',
      error: error.message,
    });
  }
});

// GET /api/sessions/:id - Get specific session
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const session = await Session.findOne({
      _id: req.params.id,
      userId: req.user.id,
      isActive: true,
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }
    
    res.json({
      success: true,
      session,
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session',
      error: error.message,
    });
  }
});

// DELETE /api/sessions/:id - Delete session
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const session = await Session.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.user.id,
        isActive: true,
      },
      {
        isActive: false,
      },
      { new: true }
    );
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }
    
    res.json({
      success: true,
      message: 'Session deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete session',
      error: error.message,
    });
  }
});

// GET /api/sessions/stats - Get session statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      // Default to last 30 days
      end = new Date();
      start = new Date();
      start.setDate(start.getDate() - 30);
    }
    
    const stats = await Session.getSessionStats(req.user.id, start, end);
    
    res.json({
      success: true,
      stats: stats[0] || {
        totalSessions: 0,
        totalDuration: 0,
        totalWords: 0,
        averageSessionDuration: 0,
        averageWordsPerMinute: 0,
        averageEngagementScore: 0,
      },
      period: {
        startDate: start,
        endDate: end,
      },
    });
  } catch (error) {
    console.error('Error fetching session stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session statistics',
      error: error.message,
    });
  }
});

// GET /api/sessions/export-test - Test route to verify routes are loading
router.get('/export-test', authenticateToken, async (req, res) => {
  res.json({
    success: true,
    message: 'Export routes are loaded!',
    timestamp: new Date().toISOString()
  });
});

// GET /api/sessions/:id/export - Export session content in different formats
router.get('/:id/export', authenticateToken, async (req, res) => {
  try {
    const { format = 'pdf' } = req.query;
    
    // First try to find active session, then try completed session
    let session = await Session.findOne({
      _id: req.params.id,
      userId: req.user.id,
      isActive: true,
    });
    
    // If not found in active, check completed sessions
    if (!session) {
      session = await Session.findOne({
        _id: req.params.id,
        userId: req.user.id,
        isActive: true, // Still check isActive but status might be 'completed'
      });
    }
    
    if (!session) {
      console.log('❌ Session not found:', req.params.id);
      return res.status(404).json({
        success: false,
        message: 'Session not found',
      });
    }

    console.log('📤 Exporting session:', session._id, 'format:', format);
    console.log('📤 Session status:', session.status);
    console.log('📤 Session content count:', session.content?.length || 0);

    // Generate content for export
    let content = '';
    let contentType = 'text/plain';
    let filename = `session-notes-${session._id}`;

    if (format === 'markdown') {
      contentType = 'text/markdown';
      filename += '.md';
      content = generateMarkdownContent(session);
    } else if (format === 'txt') {
      contentType = 'text/plain';
      filename += '.txt';
      content = generateTextContent(session);
    } else if (format === 'pdf') {
      contentType = 'application/pdf';
      filename += '.pdf';
      // For PDF, we'll need a PDF generation library
      // For now, return markdown content that can be converted to PDF
      content = generateMarkdownContent(session);
      contentType = 'text/markdown';
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid format. Supported formats: pdf, markdown, txt',
      });
    }

    console.log('📤 Generated content length:', content.length);
    console.log('📤 Content type:', contentType);

    // Set appropriate headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Send the content
    res.send(content);
  } catch (error) {
    console.error('Error exporting session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export session',
      error: error.message,
    });
  }
});

// Helper function to generate markdown content
function generateMarkdownContent(session) {
  let content = `# ${session.title}\n\n`;
  content += `**Description:** ${session.description || 'No description'}\n\n`;
  content += `**Date:** ${new Date(session.startTime).toLocaleDateString()}\n`;
  content += `**Duration:** ${Math.round((session.endTime - session.startTime) / 60000)} minutes\n\n`;
  content += `**Status:** ${session.status}\n\n`;
  
  if (session.content && session.content.length > 0) {
    content += `## Captured Content (${session.content.length} items)\n\n`;
    
    session.content.forEach((item, index) => {
      content += `### Capture ${index + 1} - ${new Date(item.timestamp).toLocaleTimeString()}\n\n`;
      content += `${item.data}\n\n`;
      if (item.topicTags && item.topicTags.length > 0) {
        content += `**Tags:** ${item.topicTags.join(', ')}\n\n`;
      }
      content += `---\n\n`;
    });
  }
  
  if (session.generatedNotes) {
    content += `## Generated Notes\n\n`;
    content += `${session.generatedNotes}\n\n`;
  }
  
  return content;
}

// Helper function to generate plain text content
function generateTextContent(session) {
  let content = `${session.title}\n`;
  content += `${'='.repeat(session.title.length)}\n\n`;
  content += `Description: ${session.description || 'No description'}\n`;
  content += `Date: ${new Date(session.startTime).toLocaleDateString()}\n`;
  content += `Duration: ${Math.round((session.endTime - session.startTime) / 60000)} minutes\n`;
  content += `Status: ${session.status}\n\n`;
  
  if (session.content && session.content.length > 0) {
    content += `Captured Content (${session.content.length} items):\n`;
    content += `${'-'.repeat(50)}\n\n`;
    
    session.content.forEach((item, index) => {
      content += `Capture ${index + 1} - ${new Date(item.timestamp).toLocaleTimeString()}:\n`;
      content += `${item.data}\n\n`;
      if (item.topicTags && item.topicTags.length > 0) {
        content += `Tags: ${item.topicTags.join(', ')}\n\n`;
      }
      content += `${'-'.repeat(30)}\n\n`;
    });
  }
  
  if (session.generatedNotes) {
    content += `Generated Notes:\n`;
    content += `${'-'.repeat(50)}\n\n`;
    content += `${session.generatedNotes}\n\n`;
  }
  
  return content;
}

module.exports = router;
