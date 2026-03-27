// AI-powered note generation utility
const natural = require('natural');

class NoteGenerator {
  constructor() {
    this.tokenizer = new natural.WordTokenizer();
    this.sentiment = new natural.SentimentAnalyzer('English', 
      natural.PorterStemmer, 'afinn');
  }

  // Generate comprehensive notes from session content
  async generateNotes(content) {
    try {
      const allText = content.map(item => item.data).join(' ');
      const words = this.tokenizer.tokenize(allText);
      
      // Generate summary
      const summary = this.generateSummary(allText, content);
      
      // Extract key points
      const keyPoints = this.extractKeyPoints(content);
      
      // Generate action items
      const actionItems = this.generateActionItems(allText);
      
      // Extract topics
      const topics = this.extractTopics(words);
      
      // Analyze sentiment
      const sentiment = this.analyzeSentiment(allText);
      
      // Calculate word count
      const wordCount = words ? words.length : 0;

      return {
        summary,
        keyPoints,
        actionItems,
        topics,
        sentiment,
        wordCount,
        generatedAt: new Date(),
      };
    } catch (error) {
      console.error('Error generating notes:', error);
      throw new Error('Failed to generate notes');
    }
  }

  // Generate summary using extractive summarization
  generateSummary(text, content) {
    try {
      const sentences = this.splitIntoSentences(text);
      
      if (sentences.length === 0) return '';
      
      // Score sentences based on various factors
      const scoredSentences = sentences.map((sentence, index) => {
        const score = this.scoreSentence(sentence, text, content, index);
        return { sentence, score, index };
      });
      
      // Sort by score and select top sentences (30% of total)
      scoredSentences.sort((a, b) => b.score - a.score);
      const topSentences = scoredSentences
        .slice(0, Math.max(1, Math.ceil(sentences.length * 0.3)))
        .sort((a, b) => a.index - b.index);
      
      return topSentences.map(item => item.sentence).join(' ');
    } catch (error) {
      console.error('Error generating summary:', error);
      return text.substring(0, 500) + '...'; // Fallback
    }
  }

  // Score a sentence for summarization
  scoreSentence(sentence, fullText, content, index) {
    let score = 0;
    
    // Length penalty (prefer medium-length sentences)
    const words = this.tokenizer.tokenize(sentence);
    const wordCount = words ? words.length : 0;
    if (wordCount >= 8 && wordCount <= 20) {
      score += 2;
    } else if (wordCount >= 5 && wordCount <= 25) {
      score += 1;
    }
    
    // Position score (earlier sentences are often more important)
    if (index < sentences.length * 0.3) {
      score += 2;
    } else if (index < sentences.length * 0.6) {
      score += 1;
    }
    
    // Keyword frequency
    const keywords = this.extractKeywords(words);
    keywords.forEach(keyword => {
      const frequency = this.countWordOccurrences(keyword, fullText);
      score += Math.min(frequency / 10, 2);
    });
    
    // Importance indicators
    if (this.containsImportantWords(sentence)) {
      score += 3;
    }
    
    // Content importance (based on metadata)
    const contentItem = content.find(item => item.data.includes(sentence.substring(0, 20)));
    if (contentItem && contentItem.metadata) {
      score += contentItem.metadata.importance;
    }
    
    return score;
  }

  // Extract key points from content
  extractKeyPoints(content) {
    const keyPoints = [];
    
    content.forEach(item => {
      const sentences = this.splitIntoSentences(item.data);
      
      sentences.forEach(sentence => {
        if (this.isKeyPoint(sentence)) {
          keyPoints.push({
            point: sentence.trim(),
            importance: item.metadata?.importance || 3,
            timestamp: item.timestamp,
          });
        }
      });
    });
    
    // Sort by importance and limit to top 10
    keyPoints.sort((a, b) => b.importance - a.importance);
    return keyPoints.slice(0, 10);
  }

  // Check if a sentence is a key point
  isKeyPoint(sentence) {
    const words = this.tokenizer.tokenize(sentence.toLowerCase());
    const wordCount = words ? words.length : 0;
    
    // Must be reasonable length
    if (wordCount < 5 || wordCount > 30) return false;
    
    // Contains important indicators
    const importantPatterns = [
      /^(important|key|main|primary|critical|essential)/i,
      /(therefore|thus|consequently|as a result)/i,
      /(firstly|secondly|finally|in conclusion)/i,
      /(should|must|need to|have to)/i,
      /(because|due to|since|as)/i,
    ];
    
    return importantPatterns.some(pattern => pattern.test(sentence));
  }

  // Generate action items from text
  generateActionItems(text) {
    const actionItems = [];
    const sentences = this.splitIntoSentences(text);
    
    sentences.forEach(sentence => {
      if (this.isActionItem(sentence)) {
        const priority = this.determinePriority(sentence);
        const dueDate = this.extractDueDate(sentence);
        
        actionItems.push({
          item: sentence.trim(),
          priority,
          dueDate,
        });
      }
    });
    
    return actionItems.slice(0, 8); // Limit to 8 action items
  }

  // Check if a sentence is an action item
  isActionItem(sentence) {
    const actionPatterns = [
      /^(need to|must|should|have to|will|going to)/i,
      /(todo|task|action|step|goal)/i,
      /(complete|finish|start|begin|create|develop)/i,
      /(review|study|learn|practice|implement)/i,
      /(schedule|plan|organize|prepare)/i,
    ];
    
    return actionPatterns.some(pattern => pattern.test(sentence));
  }

  // Determine priority of action item
  determinePriority(sentence) {
    const highPriorityWords = ['urgent', 'critical', 'important', 'immediately', 'asap'];
    const lowPriorityWords = ['later', 'sometime', 'eventually', 'maybe', 'consider'];
    
    const lowerSentence = sentence.toLowerCase();
    
    if (highPriorityWords.some(word => lowerSentence.includes(word))) {
      return 'high';
    } else if (lowPriorityWords.some(word => lowerSentence.includes(word))) {
      return 'low';
    }
    
    return 'medium';
  }

  // Extract due date from sentence
  extractDueDate(sentence) {
    const datePatterns = [
      /(\d{1,2}\/\d{1,2}\/\d{4})/, // MM/DD/YYYY
      /(\d{4}-\d{2}-\d{2})/, // YYYY-MM-DD
      /(tomorrow|today|next week|next month)/i,
      /(\d+ days? from now)/i,
    ];
    
    for (const pattern of datePatterns) {
      const match = sentence.match(pattern);
      if (match) {
        const dateStr = match[1];
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date;
        }
      }
    }
    
    return null;
  }

  // Extract topics from words
  extractTopics(words) {
    if (!words) return [];
    
    // Common academic/professional topics
    const topicKeywords = [
      'learning', 'study', 'education', 'research', 'development',
      'programming', 'coding', 'design', 'analysis', 'strategy',
      'management', 'business', 'marketing', 'finance', 'technology',
      'science', 'mathematics', 'engineering', 'health', 'medicine',
      'psychology', 'sociology', 'history', 'literature', 'art',
      'music', 'sports', 'fitness', 'nutrition', 'travel',
      'language', 'communication', 'writing', 'reading', 'speaking',
    ];
    
    const topics = new Set();
    
    words.forEach(word => {
      const lowerWord = word.toLowerCase();
      if (topicKeywords.includes(lowerWord)) {
        topics.add(lowerWord);
      }
    });
    
    return Array.from(topics).slice(0, 10);
  }

  // Analyze sentiment of text
  analyzeSentiment(text) {
    try {
      const words = this.tokenizer.tokenize(text.toLowerCase());
      if (!words || words.length === 0) return 'neutral';
      
      const score = this.sentiment.getSentiment(words);
      
      if (score > 0.1) return 'positive';
      if (score < -0.1) return 'negative';
      return 'neutral';
    } catch (error) {
      console.error('Error analyzing sentiment:', error);
      return 'neutral';
    }
  }

  // Helper methods
  splitIntoSentences(text) {
    return text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  }

  extractKeywords(words) {
    if (!words) return [];
    
    // Filter out stop words and short words
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they']);
    
    return words.filter(word => 
      word.length > 3 && 
      !stopWords.has(word.toLowerCase()) &&
      /^[a-zA-Z]+$/.test(word)
    );
  }

  countWordOccurrences(word, text) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = text.match(regex);
    return matches ? matches.length : 0;
  }

  containsImportantWords(sentence) {
    const importantWords = [
      'important', 'significant', 'crucial', 'essential', 'critical',
      'key', 'main', 'primary', 'major', 'fundamental', 'core',
      'conclusion', 'summary', 'result', 'finding', 'discovery',
    ];
    
    const lowerSentence = sentence.toLowerCase();
    return importantWords.some(word => lowerSentence.includes(word));
  }
}

// Create and export instance
const noteGenerator = new NoteGenerator();

// Export the generateNotes function for use in routes
async function generateNotes(content) {
  return await noteGenerator.generateNotes(content);
}

module.exports = {
  generateNotes,
  NoteGenerator,
};
