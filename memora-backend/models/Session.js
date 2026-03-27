const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters'],
  },
  description: {
    type: String,
    maxlength: [1000, 'Description cannot exceed 1000 characters'],
  },
  startTime: {
    type: Date,
    default: Date.now,
    required: true,
  },
  endTime: {
    type: Date,
    default: null,
  },
  duration: {
    type: Number, // in seconds
    default: 0,
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'paused'],
    default: 'active',
  },
  // Content captured during session
  content: [{
    timestamp: {
      type: Date,
      default: Date.now,
    },
    type: {
      type: String,
      enum: ['text', 'screenshot', 'note', 'screen_capture'],
      default: 'text',
    },
    data: {
      type: String,
      required: true,
    },
    metadata: {
      wordCount: Number,
      topicTags: [String],
      importance: {
        type: Number,
        min: 1,
        max: 5,
        default: 3,
      },
      // Screen capture specific metadata
      screenData: {
        captureMethod: {
          type: String,
          enum: ['manual', 'automatic', 'ocr'],
          default: 'manual',
        },
        sourceApp: String,
        windowTitle: String,
        screenSize: {
          width: Number,
          height: Number,
        },
        confidence: {
          type: Number,
          min: 0,
          max: 1,
          default: 0.8,
        },
      },
    },
  }],
  // Generated notes
  generatedNotes: {
    summary: {
      type: String,
      default: '',
    },
    keyPoints: [{
      point: String,
      importance: {
        type: Number,
        min: 1,
        max: 5,
        default: 3,
      },
      timestamp: Date,
    }],
    actionItems: [{
      item: String,
      priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium',
      },
      dueDate: Date,
    }],
    topics: [String],
    sentiment: {
      type: String,
      enum: ['positive', 'neutral', 'negative'],
      default: 'neutral',
    },
    wordCount: {
      type: Number,
      default: 0,
    },
  },
  // Session settings
  settings: {
    autoCapture: {
      type: Boolean,
      default: true,
    },
    captureInterval: {
      type: Number, // in seconds
      default: 30,
    },
    noteGeneration: {
      type: Boolean,
      default: true,
    },
    exportFormats: [{
      type: String,
      enum: ['pdf', 'markdown', 'txt', 'json'],
      default: 'markdown',
    }],
    // Screen capture specific settings
    screenCapture: {
      type: Boolean,
      default: false,
    },
    ocrEnabled: {
      type: Boolean,
      default: true,
    },
    captureMethod: {
      type: String,
      enum: ['manual', 'automatic', 'hybrid'],
      default: 'automatic',
    },
    includeImages: {
      type: Boolean,
      default: false,
    },
  },
  // Analytics
  analytics: {
    totalWords: {
      type: Number,
      default: 0,
    },
    averageWordsPerMinute: {
      type: Number,
      default: 0,
    },
    peakProductivityTime: Date,
    topicDistribution: [{
      topic: String,
      count: Number,
      percentage: Number,
    }],
    engagementScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function (doc, ret) {
      delete ret.__v;
      return ret;
    },
  },
});

// Indexes for better query performance
sessionSchema.index({ userId: 1, startTime: -1 });
sessionSchema.index({ userId: 1, status: 1 });
sessionSchema.index({ userId: 1, endTime: -1 });

// Virtual for session duration in minutes
sessionSchema.virtual('durationMinutes').get(function () {
  return Math.round(this.duration / 60);
});

// Virtual for formatted duration
sessionSchema.virtual('formattedDuration').get(function () {
  const hours = Math.floor(this.duration / 3600);
  const minutes = Math.floor((this.duration % 3600) / 60);
  const seconds = this.duration % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
});

// Instance method to end session
sessionSchema.methods.endSession = function() {
  this.endTime = new Date();
  this.duration = Math.floor((this.endTime - this.startTime) / 1000);
  this.status = 'completed';
  
  // Calculate analytics
  this.calculateAnalytics();
  
  return this.save();
};

// Instance method to add content
sessionSchema.methods.addContent = function(contentData) {
  const content = {
    timestamp: new Date(),
    type: contentData.type || 'text',
    data: contentData.data,
    metadata: {
      wordCount: contentData.data ? contentData.data.split(' ').length : 0,
      topicTags: contentData.topicTags || [],
      importance: contentData.importance || 3,
    },
  };
  
  this.content.push(content);
  
  // Update total words
  this.analytics.totalWords += content.metadata.wordCount;
  
  return this.save();
};

// Instance method to calculate analytics
sessionSchema.methods.calculateAnalytics = function() {
  if (this.duration > 0) {
    this.analytics.averageWordsPerMinute = Math.round(
      (this.analytics.totalWords / this.duration) * 60
    );
  }
  
  // Calculate topic distribution
  const topicCounts = {};
  this.content.forEach(item => {
    item.metadata.topicTags.forEach(tag => {
      topicCounts[tag] = (topicCounts[tag] || 0) + 1;
    });
  });
  
  const totalTopics = Object.values(topicCounts).reduce((a, b) => a + b, 0);
  this.analytics.topicDistribution = Object.entries(topicCounts).map(([topic, count]) => ({
    topic,
    count,
    percentage: Math.round((count / totalTopics) * 100),
  }));
  
  // Calculate engagement score (based on content frequency and duration)
  const contentFrequency = this.content.length / Math.max(this.duration / 60, 1);
  this.analytics.engagementScore = Math.min(100, Math.round(contentFrequency * 20));
};

// Static method to get active sessions
sessionSchema.statics.getActiveSession = function(userId) {
  return this.findOne({
    userId,
    status: 'active',
    isActive: true,
  }).sort({ startTime: -1 });
};

// Static method to get session history
sessionSchema.statics.getSessionHistory = function(userId, limit = 10) {
  return this.find({
    userId,
    status: 'completed',
    isActive: true,
  })
  .sort({ endTime: -1 })
  .limit(limit);
};

// Static method to get session statistics
sessionSchema.statics.getSessionStats = function(userId, startDate, endDate) {
  const matchStage = {
    userId,
    status: 'completed',
    isActive: true,
  };
  
  if (startDate && endDate) {
    matchStage.startTime = {
      $gte: startDate,
      $lte: endDate,
    };
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalSessions: { $sum: 1 },
        totalDuration: { $sum: '$duration' },
        totalWords: { $sum: '$analytics.totalWords' },
        averageSessionDuration: { $avg: '$duration' },
        averageWordsPerMinute: { $avg: '$analytics.averageWordsPerMinute' },
        averageEngagementScore: { $avg: '$analytics.engagementScore' },
      },
    },
  ]);
};

const Session = mongoose.model('Session', sessionSchema);

module.exports = Session;
