const Redis = require('redis');
const crypto = require('crypto');
const { pool } = require('../config/database');

class OptimizedCacheService {
  constructor() {
    // Redis client for hot cache (frequent lookups)
    this.redis = Redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    // Connect to Redis
    this.redis.connect().catch(console.error);
    
    // Cache TTL settings (in seconds)
    this.HOT_CACHE_TTL = 7 * 24 * 60 * 60;     // 7 days for Redis
    this.WARM_CACHE_TTL = 30 * 24 * 60 * 60;   // 30 days for DB
    this.COLD_STORAGE_TTL = 365 * 24 * 60 * 60; // 1 year for archival
  }

  /**
   * Hash email/LinkedIn URL for privacy and consistency
   */
  hashContact(input) {
    return crypto.createHash('sha256').update(input.toLowerCase().trim()).digest('hex');
  }

  /**
   * TIER 1: Check Redis hot cache (fastest, most expensive)
   */
  async checkHotCache(contactInput) {
    try {
      const hash = this.hashContact(contactInput);
      const cacheKey = `contact:${hash}`;
      
      const cached = await this.redis.hgetall(cacheKey);
      
      if (cached && Object.keys(cached).length > 0) {
        console.log('🔥 HOT CACHE HIT - Redis');
        
        // Update access count and timestamp
        await this.redis.hincrby(cacheKey, 'hits', 1);
        await this.redis.hset(cacheKey, 'last_accessed', Date.now());
        
        return {
          found: true,
          source: 'hot_cache',
          data: {
            email: cached.email || null,
            name: cached.name || null,
            linkedin_url: cached.linkedin_url || null,
            verification_status: cached.verification_status || 'unknown',
            hits: parseInt(cached.hits) + 1,
            first_found: new Date(parseInt(cached.first_found))
          },
          creditsUsed: 0
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Hot cache check failed:', error.message);
      return null;
    }
  }

  /**
   * TIER 2: Check warm cache (PostgreSQL minimal storage)
   */
  async checkWarmCache(contactInput) {
    try {
      const hash = this.hashContact(contactInput);
      const client = await pool.connect();
      
      const result = await client.query(`
        SELECT * FROM contact_hashes 
        WHERE contact_hash = $1 
        AND created_at > NOW() - INTERVAL '${this.WARM_CACHE_TTL} seconds'
        AND found_email IS NOT NULL
      `, [hash]);
      
      client.release();
      
      if (result.rows.length > 0) {
        const contact = result.rows[0];
        console.log('🌡️ WARM CACHE HIT - PostgreSQL');
        
        // Promote to hot cache for faster future access
        await this.saveToHotCache(contactInput, {
          email: contact.found_email,
          name: contact.found_name,
          linkedin_url: contact.linkedin_url,
          verification_status: contact.verification_status
        });
        
        return {
          found: true,
          source: 'warm_cache',
          data: {
            email: contact.found_email,
            name: contact.found_name,
            linkedin_url: contact.linkedin_url,
            verification_status: contact.verification_status,
            hits: contact.times_found,
            first_found: contact.created_at
          },
          creditsUsed: 0
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Warm cache check failed:', error.message);
      return null;
    }
  }

  /**
   * TIER 3: Check cold storage (basic existence check only)
   */
  async checkColdStorage(contactInput) {
    try {
      const hash = this.hashContact(contactInput);
      const client = await pool.connect();
      
      const result = await client.query(`
        SELECT contact_hash, times_searched, last_api_call 
        FROM contact_search_history 
        WHERE contact_hash = $1
      `, [hash]);
      
      client.release();
      
      if (result.rows.length > 0) {
        const history = result.rows[0];
        console.log('🧊 COLD STORAGE HIT - Previously searched but expired');
        
        return {
          found: false,
          previouslySearched: true,
          timesSearched: history.times_searched,
          lastApiCall: history.last_api_call,
          creditsUsed: 0
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Cold storage check failed:', error.message);
      return null;
    }
  }

  /**
   * Save successful API result to all cache tiers
   */
  async saveToAllTiers(contactInput, contactData) {
    await Promise.all([
      this.saveToHotCache(contactInput, contactData),
      this.saveToWarmCache(contactInput, contactData),
      this.trackSearchHistory(contactInput)
    ]);
  }

  /**
   * Save to Redis hot cache
   */
  async saveToHotCache(contactInput, contactData) {
    try {
      const hash = this.hashContact(contactInput);
      const cacheKey = `contact:${hash}`;
      
      await this.redis.hset(cacheKey, {
        email: contactData.email || '',
        name: contactData.name || '',
        linkedin_url: contactData.linkedin_url || contactInput,
        verification_status: contactData.verification_status || 'verified',
        hits: 1,
        first_found: Date.now(),
        last_accessed: Date.now()
      });
      
      // Set expiration
      await this.redis.expire(cacheKey, this.HOT_CACHE_TTL);
      
      console.log(`🔥 Saved to hot cache: ${contactData.email || contactInput}`);
    } catch (error) {
      console.error('❌ Failed to save to hot cache:', error.message);
    }
  }

  /**
   * Save to PostgreSQL warm cache (minimal data)
   */
  async saveToWarmCache(contactInput, contactData) {
    try {
      const hash = this.hashContact(contactInput);
      const client = await pool.connect();
      
      await client.query(`
        INSERT INTO contact_hashes (
          contact_hash, original_input, found_email, found_name, 
          linkedin_url, verification_status, api_source, times_found
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1)
        ON CONFLICT (contact_hash) DO UPDATE SET
          times_found = contact_hashes.times_found + 1,
          last_accessed = NOW(),
          updated_at = NOW()
      `, [
        hash, contactInput, contactData.email, contactData.name,
        contactData.linkedin_url, contactData.verification_status || 'verified',
        'findymail'
      ]);
      
      client.release();
      console.log(`🌡️ Saved to warm cache: ${contactData.email || contactInput}`);
    } catch (error) {
      console.error('❌ Failed to save to warm cache:', error.message);
    }
  }

  /**
   * Track search history for analytics (minimal storage)
   */
  async trackSearchHistory(contactInput) {
    try {
      const hash = this.hashContact(contactInput);
      const client = await pool.connect();
      
      await client.query(`
        INSERT INTO contact_search_history (contact_hash, times_searched, last_api_call)
        VALUES ($1, 1, NOW())
        ON CONFLICT (contact_hash) DO UPDATE SET
          times_searched = contact_search_history.times_searched + 1,
          last_api_call = NOW()
      `, [hash]);
      
      client.release();
    } catch (error) {
      console.error('❌ Failed to track search history:', error.message);
    }
  }

  /**
   * Main lookup function - checks all tiers
   */
  async lookupContact(contactInput) {
    console.log(`🔍 Looking up contact: ${contactInput}`);
    
    // Tier 1: Hot cache (Redis)
    const hotResult = await this.checkHotCache(contactInput);
    if (hotResult) return hotResult;
    
    // Tier 2: Warm cache (PostgreSQL)
    const warmResult = await this.checkWarmCache(contactInput);
    if (warmResult) return warmResult;
    
    // Tier 3: Cold storage (search history only)
    const coldResult = await this.checkColdStorage(contactInput);
    
    console.log('❄️ No cache hit - API call required');
    return {
      found: false,
      previouslySearched: coldResult?.previouslySearched || false,
      source: 'api_required',
      creditsUsed: 1 // Will use 1 credit for API call
    };
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    try {
      const client = await pool.connect();
      
      const [hotStats, warmStats, coldStats] = await Promise.all([
        this.redis.dbsize(), // Redis key count
        client.query('SELECT COUNT(*) as count, SUM(times_found) as total_hits FROM contact_hashes'),
        client.query('SELECT COUNT(*) as count, SUM(times_searched) as total_searches FROM contact_search_history')
      ]);
      
      client.release();
      
      return {
        hotCache: {
          entries: hotStats,
          type: 'Redis',
          ttl: `${this.HOT_CACHE_TTL / 86400} days`
        },
        warmCache: {
          entries: parseInt(warmStats.rows[0].count),
          totalHits: parseInt(warmStats.rows[0].total_hits || 0),
          type: 'PostgreSQL',
          ttl: `${this.WARM_CACHE_TTL / 86400} days`
        },
        coldStorage: {
          entries: parseInt(coldStats.rows[0].count),
          totalSearches: parseInt(coldStats.rows[0].total_searches || 0),
          type: 'PostgreSQL Archives'
        }
      };
    } catch (error) {
      console.error('❌ Failed to get cache stats:', error.message);
      return null;
    }
  }

  /**
   * Clean up expired data
   */
  async cleanup() {
    try {
      const client = await pool.connect();
      
      // Clean warm cache
      const warmCleanup = await client.query(`
        DELETE FROM contact_hashes 
        WHERE created_at < NOW() - INTERVAL '${this.WARM_CACHE_TTL} seconds'
      `);
      
      // Archive old cold storage data
      const coldCleanup = await client.query(`
        DELETE FROM contact_search_history 
        WHERE last_api_call < NOW() - INTERVAL '${this.COLD_STORAGE_TTL} seconds'
      `);
      
      client.release();
      
      console.log(`🧹 Cleanup completed: ${warmCleanup.rowCount} warm cache, ${coldCleanup.rowCount} cold storage`);
      
      return {
        warmCacheDeleted: warmCleanup.rowCount,
        coldStorageDeleted: coldCleanup.rowCount
      };
    } catch (error) {
      console.error('❌ Cleanup failed:', error.message);
      return null;
    }
  }
}

module.exports = new OptimizedCacheService();
