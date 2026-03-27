const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { body, validationResult } = require("express-validator");
const DocTag = require("../models/DocTag");
const Topic = require("../models/Topic");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../uploads/doctags");
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname),
    );
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow common file types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|mp4|mp3|zip|rar/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only images, documents, videos, and archives are allowed.",
        ),
      );
    }
  },
});

/**
 * @route   POST /api/doctags/cleanup-duplicates
 * @desc    Remove duplicate DocTag entries
 * @access  Private
 */
router.post("/cleanup-duplicates", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Find all DocTags for this user
    const allDocTags = await DocTag.find({ userId, isActive: true });

    // Group by name and type to find duplicates
    const duplicateGroups = {};
    allDocTags.forEach((docTag) => {
      const key = `${docTag.name}-${docTag.type}-${docTag.parentId || "root"}`;
      if (!duplicateGroups[key]) {
        duplicateGroups[key] = [];
      }
      duplicateGroups[key].push(docTag);
    });

    let deletedCount = 0;

    // For each group with duplicates, keep the oldest and delete the rest
    for (const [key, group] of Object.entries(duplicateGroups)) {
      if (group.length > 1) {
        // Sort by creation date (oldest first)
        group.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        // Keep the first (oldest), delete the rest
        for (let i = 1; i < group.length; i++) {
          await DocTag.findByIdAndUpdate(group[i]._id, { isActive: false });
          deletedCount++;
          console.log(
            `Deleted duplicate DocTag: ${group[i].name} (${group[i]._id})`,
          );
        }
      }
    }

    res.json({
      success: true,
      message: `Cleanup completed. Removed ${deletedCount} duplicate entries.`,
      deletedCount,
    });
  } catch (error) {
    console.error("Cleanup duplicates error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cleanup duplicates",
    });
  }
});

/**
 * @route   GET /api/doctags/health
 * @desc    Health check for DocTags API
 * @access  Public
 */
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "DocTags API is running",
    timestamp: new Date().toISOString(),
  });
});

// Helper function to sync Topics to DocTags
const syncTopicsToDocTags = async (userId) => {
  try {
    console.log("Syncing Topics to DocTags for user:", userId);

    // Get all active topics for the user
    const topics = await Topic.find({ userId, isActive: true });
    console.log("Found topics:", topics.length);

    // Create a "Topics" folder if it doesn't exist
    let topicsFolder = await DocTag.findOne({
      userId,
      name: "Topics",
      type: "folder",
      parentId: null,
      isActive: true,
    });

    if (!topicsFolder) {
      topicsFolder = new DocTag({
        userId,
        name: "Topics",
        description: "Auto-synced from your learning topics",
        type: "folder",
        category: "Other",
        color: "purple",
        icon: "book",
        parentId: null,
      });
      await topicsFolder.save();
      console.log("Created Topics folder");
    }

    // Sync each topic that has attachments or external links
    for (const topic of topics) {
      const hasAttachments = topic.attachments && topic.attachments.length > 0;
      const hasExternalLinks = topic.externalLinks &&
        topic.externalLinks.length > 0;

      if (hasAttachments || hasExternalLinks) {
        // Check if DocTag already exists for this topic
        let existingDocTag = await DocTag.findOne({
          userId,
          name: topic.title,
          parentId: topicsFolder._id,
          isActive: true,
        });

        if (!existingDocTag) {
          // Create new DocTag for this topic
          const newDocTag = new DocTag({
            userId,
            name: topic.title,
            description: topic.content ? topic.content.substring(0, 500) : "",
            type: "document",
            category: topic.category || "Other",
            tags: topic.tags || [],
            parentId: topicsFolder._id,
            attachments: topic.attachments || [],
            externalLinks: topic.externalLinks || [],
          });

          await newDocTag.save();
          console.log("Created DocTag for topic:", topic.title);
        } else {
          // Update existing DocTag with latest attachments/links
          existingDocTag.attachments = topic.attachments || [];
          existingDocTag.externalLinks = topic.externalLinks || [];
          existingDocTag.description = topic.content
            ? topic.content.substring(0, 500)
            : "";
          existingDocTag.tags = topic.tags || [];
          await existingDocTag.save();
          console.log("Updated DocTag for topic:", topic.title);
        }
      }
    }

    console.log("Topic sync completed");
  } catch (error) {
    console.error("Error syncing topics to DocTags:", error);
  }
};

// Helper function to handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors.array(),
    });
  }
  next();
};

/**
 * @route   POST /api/doctags/upload
 * @desc    Upload files for DocTags
 * @access  Private
 */
router.post(
  "/upload",
  authenticateToken,
  upload.array("files", 5),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No files uploaded",
        });
      }

      const uploadedFiles = req.files.map((file) => {
        // Determine file type
        let fileType = "other";
        if (file.mimetype.startsWith("image/")) fileType = "image";
        else if (file.mimetype.startsWith("video/")) fileType = "video";
        else if (file.mimetype.startsWith("audio/")) fileType = "audio";
        else if (file.mimetype === "application/pdf") fileType = "pdf";
        else if (
          file.mimetype.includes("document") || file.mimetype.includes("word")
        ) fileType = "document";

        return {
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          url: `/uploads/doctags/${file.filename}`,
          fileType: fileType,
          uploadedAt: new Date(),
        };
      });

      res.json({
        success: true,
        message: `${uploadedFiles.length} file(s) uploaded successfully`,
        files: uploadedFiles,
      });
    } catch (error) {
      console.error("File upload error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to upload files",
      });
    }
  },
);

/**
 * @route   GET /api/doctags
 * @desc    Get user's documents and folders with optional filtering
 * @access  Private
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    console.log("DocTags GET request received");
    console.log("Query params:", req.query);
    console.log("User ID:", req.user?.id);

    const { parentId, type, category, search, limit = 50, page = 1 } =
      req.query;
    const userId = req.user.id;

    // Auto-sync topics to DocTags before fetching (DISABLED to prevent duplicates)
    // await syncTopicsToDocTags(userId);

    let query = { userId, isActive: true };

    // Apply filters
    if (parentId !== undefined) {
      query.parentId = parentId === "null" ? null : parentId;
    }
    if (type) query.type = type;
    if (category) query.category = category;

    let docTagsQuery;

    // Apply search if provided
    if (search) {
      docTagsQuery = DocTag.searchDocTags(userId, search, {
        type,
        category,
        limit: parseInt(limit),
      });
    } else {
      docTagsQuery = DocTag.find(query)
        .sort({ type: -1, name: 1 }) // Folders first, then documents, alphabetically
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit));
    }

    const docTags = await docTagsQuery;
    const total = await DocTag.countDocuments(query);

    console.log("DocTags found:", docTags.length);
    console.log("Total count:", total);

    res.json({
      success: true,
      docTags,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get docTags error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get documents and folders",
    });
  }
});

/**
 * @route   GET /api/doctags/recent
 * @desc    Get recently accessed documents
 * @access  Private
 */
router.get("/recent", authenticateToken, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const userId = req.user.id;

    const recentDocs = await DocTag.getRecentDocuments(userId, parseInt(limit));

    res.json({
      success: true,
      documents: recentDocs,
      count: recentDocs.length,
    });
  } catch (error) {
    console.error("Get recent documents error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get recent documents",
    });
  }
});

/**
 * @route   GET /api/doctags/favorites
 * @desc    Get user's favorite documents and folders
 * @access  Private
 */
router.get("/favorites", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const favorites = await DocTag.getFavorites(userId);

    res.json({
      success: true,
      favorites,
      count: favorites.length,
    });
  } catch (error) {
    console.error("Get favorites error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get favorites",
    });
  }
});

/**
 * @route   GET /api/doctags/structure/:parentId?
 * @desc    Get folder structure for a specific parent (or root if no parentId)
 * @access  Private
 */
router.get("/structure/:parentId?", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { parentId } = req.params;

    const structure = await DocTag.getFolderStructure(
      userId,
      parentId === "root" ? null : parentId,
    );

    res.json({
      success: true,
      structure,
      count: structure.length,
    });
  } catch (error) {
    console.error("Get folder structure error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get folder structure",
    });
  }
});

/**
 * @route   POST /api/doctags
 * @desc    Create a new document or folder
 * @access  Private
 */
router.post(
  "/",
  authenticateToken,
  [
    body("name")
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage("Name must be between 1 and 200 characters"),
    body("type")
      .isIn(["folder", "document"])
      .withMessage("Type must be either folder or document"),
    body("description")
      .optional()
      .isLength({ max: 1000 })
      .withMessage("Description cannot exceed 1000 characters"),
    body("parentId")
      .optional()
      .isMongoId()
      .withMessage("Parent ID must be a valid MongoDB ObjectId"),
    body("category")
      .optional()
      .isIn([
        "Science",
        "Mathematics",
        "History",
        "Language",
        "Technology",
        "Arts",
        "Business",
        "Personal",
        "Research",
        "Other",
      ])
      .withMessage("Invalid category"),
    body("tags")
      .optional()
      .isArray()
      .withMessage("Tags must be an array"),
    body("color")
      .optional()
      .isIn([
        "blue",
        "green",
        "purple",
        "red",
        "orange",
        "yellow",
        "pink",
        "gray",
      ])
      .withMessage("Invalid color"),
    body("icon")
      .optional()
      .isIn([
        "folder",
        "book",
        "code",
        "science",
        "math",
        "art",
        "music",
        "video",
        "image",
        "document",
      ])
      .withMessage("Invalid icon"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const docTagData = {
        ...req.body,
        userId,
        parentId: req.body.parentId || null,
      };

      // If creating a document, ensure it has at least one attachment or external link
      if (
        req.body.type === "document" &&
        (!req.body.attachments || req.body.attachments.length === 0) &&
        (!req.body.externalLinks || req.body.externalLinks.length === 0)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Documents must have at least one attachment or external link",
        });
      }

      const docTag = new DocTag(docTagData);
      await docTag.save();

      console.log('📝 DocTag created successfully:', {
        id: docTag._id,
        name: docTag.name,
        attachmentsCount: docTag.attachments?.length || 0,
        firstAttachmentUrl: docTag.attachments?.[0]?.url?.substring(0, 100) + '...' || 'No attachments'
      });

      res.status(201).json({
        success: true,
        message: `${
          req.body.type === "folder" ? "Folder" : "Document"
        } created successfully`,
        docTag,
      });
    } catch (error) {
      console.error("Create docTag error:", error);

      if (error.name === "ValidationError") {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: Object.values(error.errors).map((err) => err.message),
        });
      }

      res.status(500).json({
        success: false,
        message: "Failed to create document/folder",
      });
    }
  },
);

/**
 * @route   PUT /api/doctags/:id
 * @desc    Update a document or folder
 * @access  Private
 */
router.put(
  "/:id",
  authenticateToken,
  [
    body("name")
      .optional()
      .trim()
      .isLength({ min: 1, max: 200 })
      .withMessage("Name must be between 1 and 200 characters"),
    body("description")
      .optional()
      .isLength({ max: 1000 })
      .withMessage("Description cannot exceed 1000 characters"),
    body("category")
      .optional()
      .isIn([
        "Science",
        "Mathematics",
        "History",
        "Language",
        "Technology",
        "Arts",
        "Business",
        "Personal",
        "Research",
        "Other",
      ])
      .withMessage("Invalid category"),
    body("tags")
      .optional()
      .isArray()
      .withMessage("Tags must be an array"),
    body("color")
      .optional()
      .isIn([
        "blue",
        "green",
        "purple",
        "red",
        "orange",
        "yellow",
        "pink",
        "gray",
      ])
      .withMessage("Invalid color"),
    body("icon")
      .optional()
      .isIn([
        "folder",
        "book",
        "code",
        "science",
        "math",
        "art",
        "music",
        "video",
        "image",
        "document",
      ])
      .withMessage("Invalid icon"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const docTag = await DocTag.findOne({ _id: id, userId, isActive: true });

      if (!docTag) {
        return res.status(404).json({
          success: false,
          message: "Document/folder not found",
        });
      }

      // Update fields
      Object.keys(req.body).forEach((key) => {
        if (req.body[key] !== undefined) {
          docTag[key] = req.body[key];
        }
      });

      await docTag.save();

      res.json({
        success: true,
        message: "Document/folder updated successfully",
        docTag,
      });
    } catch (error) {
      console.error("Update docTag error:", error);

      if (error.name === "ValidationError") {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: Object.values(error.errors).map((err) => err.message),
        });
      }

      res.status(500).json({
        success: false,
        message: "Failed to update document/folder",
      });
    }
  },
);

/**
 * @route   DELETE /api/doctags/:id
 * @desc    Delete a document or folder (soft delete)
 * @access  Private
 */
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const docTag = await DocTag.findOne({ _id: id, userId, isActive: true });

    if (!docTag) {
      return res.status(404).json({
        success: false,
        message: "Document/folder not found",
      });
    }

    // If it's a folder, also soft delete all children
    if (docTag.type === "folder") {
      const children = await docTag.getAllChildren();
      await DocTag.updateMany(
        { _id: { $in: children.map((child) => child._id) } },
        { isActive: false },
      );
    }

    docTag.isActive = false;
    await docTag.save();

    res.json({
      success: true,
      message: `${
        docTag.type === "folder" ? "Folder" : "Document"
      } deleted successfully`,
    });
  } catch (error) {
    console.error("Delete docTag error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete document/folder",
    });
  }
});

module.exports = router;
