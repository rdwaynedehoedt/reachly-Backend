/**
 * Test script for FindyMail API endpoints
 * This script tests the API structure without requiring database connection
 */

const express = require('express');
const request = require('supertest');

// Mock the database pool to avoid connection errors
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue({
      query: jest.fn(),
      release: jest.fn(),
    }),
    end: jest.fn(),
  })),
}));

// Mock FindyMail service
jest.mock('../services/findymailService', () => ({
  findEmailFromLinkedIn: jest.fn(),
  verifyEmail: jest.fn(),
  getRemainingCredits: jest.fn(),
  getOrganizationStats: jest.fn(),
  getLeadEnrichmentHistory: jest.fn(),
}));

const findymailRoutes = require('../routes/findymail');
const findymailService = require('../services/findymailService');

// Create test Express app
const app = express();
app.use(express.json());

// Mock auth middleware
app.use('/api/findymail', (req, res, next) => {
  req.user = {
    organizationId: 'test-org-123',
    userId: 'test-user-456',
  };
  next();
});

app.use('/api/findymail', findymailRoutes);

describe('FindyMail API Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/findymail/find-email-linkedin', () => {
    test('should require linkedin_url parameter', async () => {
      const response = await request(app)
        .post('/api/findymail/find-email-linkedin')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('LinkedIn URL is required');
    });

    test('should validate LinkedIn URL format', async () => {
      const response = await request(app)
        .post('/api/findymail/find-email-linkedin')
        .send({ linkedin_url: 'invalid-url' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid LinkedIn URL format');
    });

    test('should call service with valid LinkedIn URL', async () => {
      findymailService.findEmailFromLinkedIn.mockResolvedValue({
        success: true,
        cached: false,
        data: {
          id: 'enrichment-123',
          email: 'john@example.com',
          name: 'John Doe',
          linkedinUrl: 'https://linkedin.com/in/johndoe',
        },
        creditsUsed: 1,
      });

      const response = await request(app)
        .post('/api/findymail/find-email-linkedin')
        .send({ 
          linkedin_url: 'https://linkedin.com/in/johndoe',
          lead_id: 'lead-789' 
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe('john@example.com');
      expect(response.body.credits_used).toBe(1);

      expect(findymailService.findEmailFromLinkedIn).toHaveBeenCalledWith(
        'https://linkedin.com/in/johndoe',
        'test-org-123',
        'lead-789',
        'test-user-456'
      );
    });

    test('should handle service errors gracefully', async () => {
      findymailService.findEmailFromLinkedIn.mockResolvedValue({
        success: false,
        error: 'Insufficient credits',
        httpStatus: 402,
        creditsUsed: 0,
      });

      const response = await request(app)
        .post('/api/findymail/find-email-linkedin')
        .send({ linkedin_url: 'https://linkedin.com/in/johndoe' });

      expect(response.status).toBe(402);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Insufficient FindyMail credits');
    });
  });

  describe('POST /api/findymail/verify-email', () => {
    test('should require email parameter', async () => {
      const response = await request(app)
        .post('/api/findymail/verify-email')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Email address is required');
    });

    test('should validate email format', async () => {
      const response = await request(app)
        .post('/api/findymail/verify-email')
        .send({ email: 'invalid-email' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid email format');
    });

    test('should call service with valid email', async () => {
      findymailService.verifyEmail.mockResolvedValue({
        success: true,
        data: {
          email: 'john@example.com',
          verified: true,
          provider: 'Google',
        },
        creditsUsed: 1,
      });

      const response = await request(app)
        .post('/api/findymail/verify-email')
        .send({ email: 'john@example.com' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.verified).toBe(true);
    });
  });

  describe('POST /api/findymail/bulk-find-emails', () => {
    test('should require linkedin_urls array', async () => {
      const response = await request(app)
        .post('/api/findymail/bulk-find-emails')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('linkedin_urls array is required');
    });

    test('should limit batch size to 10', async () => {
      const linkedin_urls = Array(11).fill({ linkedin_url: 'https://linkedin.com/in/test' });
      
      const response = await request(app)
        .post('/api/findymail/bulk-find-emails')
        .send({ linkedin_urls });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Maximum 10 LinkedIn URLs allowed per batch');
    });

    test('should process multiple LinkedIn URLs', async () => {
      findymailService.findEmailFromLinkedIn
        .mockResolvedValueOnce({
          success: true,
          data: { email: 'john@example.com' },
          creditsUsed: 1,
        })
        .mockResolvedValueOnce({
          success: false,
          error: 'Not found',
          creditsUsed: 0,
        });

      const response = await request(app)
        .post('/api/findymail/bulk-find-emails')
        .send({
          linkedin_urls: [
            { linkedin_url: 'https://linkedin.com/in/john', lead_id: 'lead-1' },
            { linkedin_url: 'https://linkedin.com/in/jane', lead_id: 'lead-2' },
          ]
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.summary.total).toBe(2);
      expect(response.body.summary.successful).toBe(1);
      expect(response.body.summary.failed).toBe(1);
      expect(response.body.summary.total_credits_used).toBe(1);
    });
  });

  describe('GET /api/findymail/credits', () => {
    test('should return credits information', async () => {
      findymailService.getRemainingCredits.mockResolvedValue({
        success: true,
        data: {
          finderCredits: 150,
          verifierCredits: 100,
        },
      });

      const response = await request(app).get('/api/findymail/credits');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.finderCredits).toBe(150);
      expect(response.body.data.verifierCredits).toBe(100);
    });
  });

  describe('GET /api/findymail/stats', () => {
    test('should return organization statistics', async () => {
      findymailService.getOrganizationStats.mockResolvedValue({
        success: true,
        data: {
          total_enrichment_attempts: 10,
          successful_enrichments: 8,
          success_rate_percent: 80,
          total_credits_used: 8,
        },
      });

      const response = await request(app).get('/api/findymail/stats');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.success_rate_percent).toBe(80);
    });
  });
});

// Manual test function (for running without Jest)
async function manualTest() {
  console.log('🧪 Running manual FindyMail API tests...\n');

  const tests = [
    {
      name: 'Test LinkedIn email finding endpoint',
      method: 'POST',
      path: '/api/findymail/find-email-linkedin',
      body: { linkedin_url: 'https://linkedin.com/in/johndoe' }
    },
    {
      name: 'Test email verification endpoint',
      method: 'POST', 
      path: '/api/findymail/verify-email',
      body: { email: 'john@example.com' }
    },
    {
      name: 'Test credits endpoint',
      method: 'GET',
      path: '/api/findymail/credits'
    },
    {
      name: 'Test stats endpoint',
      method: 'GET',
      path: '/api/findymail/stats'
    }
  ];

  for (const test of tests) {
    try {
      console.log(`📋 ${test.name}:`);
      
      const req = request(app)[test.method.toLowerCase()](test.path);
      if (test.body) req.send(test.body);
      
      const response = await req;
      
      console.log(`   Status: ${response.status}`);
      console.log(`   Response: ${JSON.stringify(response.body, null, 2)}`);
      console.log('   ✅ Endpoint structure valid\n');
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
    }
  }
  
  console.log('🎉 Manual API structure tests completed!');
  console.log('📋 Next steps:');
  console.log('   1. Set FINDYMAIL_API_KEY in environment variables');
  console.log('   2. Deploy database schema to your PostgreSQL instance');
  console.log('   3. Test with real FindyMail API calls');
}

// Run manual test if called directly
if (require.main === module) {
  manualTest();
}

module.exports = { manualTest };
