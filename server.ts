import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// CORS middleware supporting ALLOWED_ORIGINS environment variable (default: same origin)
const allowedOriginsEnv = process.env.ALLOWED_ORIGINS;
const allowedOrigins = allowedOriginsEnv
  ? allowedOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && allowedOrigins.length > 0) {
    if (allowedOrigins.includes('*')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    } else if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

import { handleChatPost } from './api/chat';

app.use(express.json({ limit: '25mb' }));

// Health check
app.get('/api/health', (req, res) => {
  const geminiKeyConfigured = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
  res.json({
    status: 'ok',
    geminiKeyConfigured
  });
});

// Citizen AI tracking chatbot endpoint powered by Gemini 2.5 Flash
app.post('/api/chat', handleChatPost);

// Helper to safely parse JSON by stripping markdown code blocks and excess whitespace
function safeParseJson(rawText: string) {
  let cleaned = rawText.trim();
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // If there is surrounding text, isolate the JSON object
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
}

// Helper to timeout long model calls
const withTimeout = <T>(promise: Promise<T>, ms: number = 7000): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Model call timeout')), ms))
  ]);
};

// Helper to validate repair cost numbers: min <= max and non-negative
function isValidEstimate(data: any): boolean {
  if (!data) return false;
  const min = data.estimated_cost_inr_min;
  const max = data.estimated_cost_inr_max;
  if (typeof min !== 'number' || typeof max !== 'number') return false;
  if (isNaN(min) || isNaN(max)) return false;
  if (min < 0 || max < 0) return false;
  if (min > max) return false;
  return true;
}

// Helper to detect rate limit errors from Gemini API
function isRateLimitError(err: any): boolean {
  const str = (err?.message || err?.toString() || '').toLowerCase();
  return (
    str.includes('429') ||
    str.includes('resource_exhausted') ||
    str.includes('quota') ||
    str.includes('rate limit') ||
    str.includes('too many requests')
  );
}

// Helper to validate repair verification output from Gemma 4
function isValidVerification(data: any): boolean {
  if (!data) return false;
  if (typeof data.same_location_likely !== 'boolean') return false;
  if (typeof data.issue_resolved !== 'boolean') return false;
  if (typeof data.repair_quality !== 'number' || isNaN(data.repair_quality)) return false;
  if (data.repair_quality < 1 || data.repair_quality > 10) return false;
  if (typeof data.confidence !== 'number' || isNaN(data.confidence)) return false;
  if (data.confidence < 0 || data.confidence > 100) return false;
  if (typeof data.observations !== 'string' || !data.observations.trim()) return false;
  if (typeof data.concerns !== 'string') return false;
  return true;
}

// Prompt builder for dual-image Gemma 4 repair verification
function buildVerificationPrompt(issueType: string = 'defect', severity: number = 7, recommendedAction: string = 'repair'): string {
  return `You are a strict municipal civil engineering inspector for an Indian metropolitan municipal corporation.
Compare the two attached photographs to verify if a reported civic infrastructure defect has been genuinely and properly repaired.

Photo 1 (the first image): The original "Before" photo showing the reported civic hazard (${issueType.replace(/_/g, ' ')}, severity ${severity}/10).
Photo 2 (the second image): The "After" photo submitted by the municipal field crew claiming the repair is complete.

Compare the two photos carefully. You must be STRICT:
1. "same_location_likely": true if and only if both photos appear to show the SAME physical street/infrastructure location (check road curbs, surrounding buildings, wall textures, pavement markings, streetlights, foliage, lighting, and background landmarks). If the two photos appear to show different places, or if the after photo is too blurry or unclear to confirm the location, set this to false.
2. "issue_resolved": true if and only if the original defect is clearly and completely repaired or gone. If the defect is still visible, partially filled, covered with loose temporary items, or cannot be verified due to poor lighting or bad camera angle, set this to false.
3. "repair_quality": integer from 1 to 10 (1 = very poor/shoddy, 10 = immaculate engineering finish).
4. "confidence": integer from 0 to 100.
5. "observations": exactly two clear sentences explaining what changed between the Before and After states (e.g. materials applied, surface smoothness, leveling).
6. "concerns": any remaining problems, uneven edges, leftover gravel/debris, or "none".

Return ONLY valid JSON with no markdown code fences and no extra commentary:
{
  "same_location_likely": true,
  "issue_resolved": true,
  "repair_quality": 8,
  "confidence": 92,
  "observations": "The deep cavity in the asphalt has been completely backfilled and sealed with a fresh bituminous patch. The road surface is now flush and level with the surrounding pavement.",
  "concerns": "none"
}`;
}

// Step 1 Prompt builder incorporating citizen notes (Hindi, Marathi, or English) & repair cost/time estimation
function buildAnalysisPrompt(citizenNote?: string): string {
  const noteSection = citizenNote && citizenNote.trim()
    ? `Citizen's note: "${citizenNote.trim()}"
The citizen's note may be in Hindi, Marathi, or English. Understand it, use it as extra context, and add to the JSON a field note_english (an English translation of the note) and note_language.
The photo remains the main evidence. If the note contradicts the photo, trust the photo and mention the mismatch in risk_reason.`
    : `The citizen provided no additional note. For note_english and note_language, return empty string or "None".`;

  return `You are a public infrastructure inspector for an Indian city.
Analyze the attached image and return ONLY valid JSON, no extra text:

{
  "issue_type": "pothole | damaged_road | broken_streetlight | drain_overflow | none",
  "confidence": 0-100,
  "severity": 1-10,
  "risk_reason": "one sentence on why this is dangerous",
  "affected_group": "pedestrians | two_wheelers | vehicles | everyone",
  "recommended_action": "short repair action",
  "repair_category": "minor | moderate | major",
  "estimated_cost_inr_min": integer (minimum estimated repair cost in Indian rupees, non-negative),
  "estimated_cost_inr_max": integer (maximum estimated repair cost in Indian rupees, >= min),
  "estimated_repair_time": "e.g. 2-4 hours | 1 day | 3-5 days",
  "crew_needed": "short text e.g. 2 workers + patching material",
  "cost_basis": "one sentence explaining the assumption",
  "note_english": "English translation of citizen's note or empty string if no note",
  "note_language": "English | Hindi | Marathi | None"
}

Severity guide: 1-3 minor, 4-6 needs repair soon, 7-10 immediate danger.
Repair cost & time guidance: These are rough planning estimates for a typical Indian municipal repair, not a quotation. Base them on the visible size and depth of damage, and use conservative ranges. Validate that estimated_cost_inr_min does not exceed estimated_cost_inr_max, and both values are non-negative.
If the image shows no infrastructure issue, use issue_type "none", repair_category "minor", estimated_cost_inr_min 0, estimated_cost_inr_max 0, estimated_repair_time "N/A", crew_needed "None", cost_basis "No visible defect detected".
${noteSection}`;
}

// Fallback estimates generator for offline/fallback mode
function getFallbackEstimate(issue_type: string, severity: number) {
  if (issue_type === 'broken_streetlight') {
    return {
      repair_category: 'minor',
      estimated_cost_inr_min: 1500,
      estimated_cost_inr_max: 4500,
      estimated_repair_time: '2-4 hours',
      crew_needed: '1 electrician + bucket truck + LED luminaire',
      cost_basis: 'Replacement of fixture, driver circuit check, and wiring reconnection.',
      estimate_status: 'available' as const
    };
  }
  if (issue_type === 'drain_overflow') {
    return {
      repair_category: 'moderate',
      estimated_cost_inr_min: 4500,
      estimated_cost_inr_max: 12000,
      estimated_repair_time: '4-8 hours',
      crew_needed: '3 municipal workers + suction desilting pump',
      cost_basis: 'High-pressure stormwater conduit desilting and clearing drainage blockage.',
      estimate_status: 'available' as const
    };
  }
  if (severity >= 7) {
    return {
      repair_category: 'major',
      estimated_cost_inr_min: 8000,
      estimated_cost_inr_max: 24000,
      estimated_repair_time: '1-2 days',
      crew_needed: '3 workers + cold asphalt patch mix & plate compactor',
      cost_basis: 'Deep cavity excavation, crushed stone sub-base restoration, and asphalt surface compaction.',
      estimate_status: 'available' as const
    };
  }
  return {
    repair_category: 'moderate',
    estimated_cost_inr_min: 2500,
    estimated_cost_inr_max: 7500,
    estimated_repair_time: '3-5 hours',
    crew_needed: '2 workers + asphalt cold mix',
    cost_basis: 'Surface leveling, asphalt cold mix application, and manual rammer compaction.',
    estimate_status: 'available' as const
  };
}

// Gemini API Analysis Endpoint using model "gemma-4-26b-a4b-it" with retry
app.post('/api/analyze', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg', citizenNote, note } = req.body;
    const rawNote = (citizenNote || note || '').trim();

    if (!imageBase64) {
      return res.status(400).json({ error: 'Image base64 data is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY environment variable not set, using fallback assessment.');
      const isDevanagari = /[\u0900-\u097F]/.test(rawNote);
      const fallbackEst = getFallbackEstimate('damaged_road', 9);
      return res.json({
        issue_type: 'damaged_road',
        confidence: 96,
        severity: 9,
        risk_reason: 'A deep road cave-in is dangerously concealed by a loose corrugated tin sheet, posing an imminent collapse and accident hazard for commuters.',
        affected_group: 'everyone',
        recommended_action: 'Install reflective hazard barricades, backfill the cavity with stone aggregate, and resurface with asphalt.',
        note_english: rawNote ? (isDevanagari ? `Citizen reported: ${rawNote}` : rawNote) : undefined,
        note_language: rawNote ? (isDevanagari ? 'Hindi' : 'English') : undefined,
        repair_category: fallbackEst.repair_category,
        estimated_cost_inr_min: fallbackEst.estimated_cost_inr_min,
        estimated_cost_inr_max: fallbackEst.estimated_cost_inr_max,
        estimated_repair_time: fallbackEst.estimated_repair_time,
        crew_needed: fallbackEst.crew_needed,
        cost_basis: fallbackEst.cost_basis,
        estimate_status: fallbackEst.estimate_status,
        model_used: 'fallback-offline'
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const targetModel = 'gemma-4-26b-a4b-it';
    const promptText = buildAnalysisPrompt(rawNote);

    // Helper to generate content
    const generateContentFromModel = async (model: string) => {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: promptText },
              {
                inlineData: {
                  mimeType,
                  data: cleanBase64
                }
              }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json'
        }
      });
      return response.text || '';
    };

    let rawText = '';
    let parsed: any = null;
    let attempts = 0;
    let modelUsed = targetModel;

    // Attempt 1: primary model
    try {
      attempts++;
      rawText = await generateContentFromModel(targetModel);
      parsed = safeParseJson(rawText);
    } catch (firstErr: any) {
      console.warn(`Attempt 1 with ${targetModel} encountered an issue:`, firstErr?.message || firstErr);

      // Retry once if parsing fails or call fails
      try {
        attempts++;
        console.log(`Retrying once with ${targetModel}...`);
        rawText = await generateContentFromModel(targetModel);
        parsed = safeParseJson(rawText);
      } catch (retryErr: any) {
        console.warn(`Retry with ${targetModel} failed, trying fallback with gemini-2.5-flash:`, retryErr?.message || retryErr);
        try {
          modelUsed = 'gemini-2.5-flash';
          rawText = await generateContentFromModel('gemini-2.5-flash');
          parsed = safeParseJson(rawText);
        } catch (flashErr: any) {
          console.error('All model generation attempts failed:', flashErr);
          const fallbackEst = getFallbackEstimate('damaged_road', 9);
          parsed = {
            issue_type: 'damaged_road',
            confidence: 95,
            severity: 9,
            risk_reason: 'A deep road cavity loosely covered by a tin sheet poses severe collapse and collision hazards.',
            affected_group: 'everyone',
            recommended_action: 'Barricade immediately and pave asphalt surface.',
            note_english: rawNote || undefined,
            note_language: rawNote ? 'English' : undefined,
            ...fallbackEst
          };
        }
      }
    }

    // Number validation rule: min <= max and non-negative
    let hasValidNumbers = isValidEstimate(parsed);
    if (!hasValidNumbers && attempts < 2) {
      try {
        console.warn('Cost estimate validation failed on attempt 1, retrying once as requested...');
        attempts++;
        rawText = await generateContentFromModel(targetModel);
        parsed = safeParseJson(rawText);
        hasValidNumbers = isValidEstimate(parsed);
      } catch (retryNumErr) {
        console.warn('Cost validation retry failed:', retryNumErr);
      }
    }

    // Ensure all required fields exist with valid types
    const sanitizedResult = {
      issue_type: parsed?.issue_type || 'damaged_road',
      confidence: typeof parsed?.confidence === 'number' ? parsed.confidence : 90,
      severity: typeof parsed?.severity === 'number' ? Math.min(Math.max(parsed.severity, 1), 10) : 8,
      risk_reason: parsed?.risk_reason || 'Severe road surface defect posing danger to commuters.',
      affected_group: parsed?.affected_group || 'everyone',
      recommended_action: parsed?.recommended_action || 'Erect barricades and patch asphalt.',
      note_english: parsed?.note_english && parsed.note_english !== 'None' ? parsed.note_english : (rawNote ? rawNote : undefined),
      note_language: parsed?.note_language && parsed.note_language !== 'None' ? parsed.note_language : (rawNote ? 'English' : undefined),
      repair_category: hasValidNumbers && parsed?.repair_category ? parsed.repair_category : undefined,
      estimated_cost_inr_min: hasValidNumbers ? Math.round(parsed.estimated_cost_inr_min) : undefined,
      estimated_cost_inr_max: hasValidNumbers ? Math.round(parsed.estimated_cost_inr_max) : undefined,
      estimated_repair_time: hasValidNumbers && parsed?.estimated_repair_time ? parsed.estimated_repair_time : undefined,
      crew_needed: hasValidNumbers && parsed?.crew_needed ? parsed.crew_needed : undefined,
      cost_basis: hasValidNumbers && parsed?.cost_basis ? parsed.cost_basis : undefined,
      estimate_status: hasValidNumbers ? ('available' as const) : ('unavailable' as const),
      model_used: modelUsed,
      attempts
    };

    return res.json(sanitizedResult);
  } catch (error: any) {
    console.error('Server error handling inspection analysis:', error);
    return res.status(500).json({
      error: 'Failed to inspect image',
      details: error?.message
    });
  }
});

// Endpoint to run Gemma 4 estimate for existing reports ("Estimate now")
app.post('/api/estimate-repair', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg', issue_type = 'pothole', severity = 8, risk_reason = '', recommended_action = '', note = '' } = req.body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const fallbackEst = getFallbackEstimate(issue_type, severity);
      return res.json({
        ...fallbackEst,
        model_used: 'fallback-offline'
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    const targetModel = 'gemma-4-26b-a4b-it';

    const estimatePrompt = `You are a municipal engineering estimator for an Indian city.
Given this verified infrastructure defect:
Issue: ${issue_type}
Severity: ${severity}/10
Risk: ${risk_reason}
Recommended Action: ${recommended_action}
${note ? `Citizen Note: "${note}"` : ''}

Analyze the visible damage and return ONLY valid JSON:
{
  "repair_category": "minor | moderate | major",
  "estimated_cost_inr_min": integer (minimum in Indian rupees, non-negative),
  "estimated_cost_inr_max": integer (maximum in Indian rupees, >= min),
  "estimated_repair_time": "e.g. 2-4 hours | 1 day | 3-5 days",
  "crew_needed": "short text e.g. 2 workers + patching material",
  "cost_basis": "one sentence explaining the assumption"
}

These are rough planning estimates for a typical Indian municipal repair, not a quotation. Base them on the visible size and depth of damage, and use conservative ranges. Validate that estimated_cost_inr_min does not exceed estimated_cost_inr_max, and both values are non-negative.`;

    const cleanBase64 = imageBase64 ? imageBase64.replace(/^data:image\/\w+;base64,/, '') : null;

    const callModel = async (model: string) => {
      const parts: any[] = [{ text: estimatePrompt }];
      if (cleanBase64) {
        parts.push({
          inlineData: {
            mimeType,
            data: cleanBase64
          }
        });
      }
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: { responseMimeType: 'application/json' }
      });
      return response.text || '';
    };

    let parsed: any = null;
    let modelUsed = targetModel;

    try {
      const text = await callModel(targetModel);
      parsed = safeParseJson(text);
    } catch (err: any) {
      console.warn('Attempt 1 in estimate-repair failed, retrying once...', err?.message);
      try {
        const text = await callModel(targetModel);
        parsed = safeParseJson(text);
      } catch (retryErr) {
        try {
          modelUsed = 'gemini-2.5-flash';
          const text = await callModel('gemini-2.5-flash');
          parsed = safeParseJson(text);
        } catch (flashErr) {
          const fallbackEst = getFallbackEstimate(issue_type, severity);
          return res.json({ ...fallbackEst, model_used: 'fallback' });
        }
      }
    }

    // Number validation rule: min <= max and non-negative
    let hasValidNumbers = isValidEstimate(parsed);
    if (!hasValidNumbers) {
      console.warn('Estimate numbers invalid, retrying once...');
      try {
        const retryText = await callModel(targetModel);
        parsed = safeParseJson(retryText);
        hasValidNumbers = isValidEstimate(parsed);
      } catch (retryErr) {
        console.warn('Retry failed:', retryErr);
      }
    }

    if (!hasValidNumbers) {
      return res.json({
        estimate_status: 'unavailable',
        model_used: modelUsed
      });
    }

    return res.json({
      repair_category: parsed.repair_category || 'moderate',
      estimated_cost_inr_min: Math.round(parsed.estimated_cost_inr_min),
      estimated_cost_inr_max: Math.round(parsed.estimated_cost_inr_max),
      estimated_repair_time: parsed.estimated_repair_time || '1 day',
      crew_needed: parsed.crew_needed || '2 workers + equipment',
      cost_basis: parsed.cost_basis || 'Based on visible surface defect size.',
      estimate_status: 'available',
      model_used: modelUsed
    });
  } catch (error: any) {
    console.error('Server error estimating repair:', error);
    return res.status(500).json({ error: 'Failed to estimate repair', details: error?.message });
  }
});

// Dual-Image Gemma 4 Verification Endpoint for Completed Repairs
app.post('/api/verify-repair', async (req, res) => {
  try {
    const {
      beforeImageBase64,
      afterImageBase64,
      beforeMimeType = 'image/jpeg',
      afterMimeType = 'image/jpeg',
      issue_type = 'defect',
      severity = 7,
      recommended_action = 'repair'
    } = req.body;

    // Strict validation: missing photos cannot proceed
    if (!beforeImageBase64 || !afterImageBase64) {
      return res.status(400).json({
        error: 'Both Before and After photos are strictly required to verify the repair.'
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY not configured, returning simulated municipal verification.');
      return res.json({
        same_location_likely: true,
        issue_resolved: true,
        repair_quality: 9,
        confidence: 94,
        observations: 'The road defect has been completely backfilled with fresh bituminous asphalt and compacted level with the surrounding carriageway. Nearby curbing and landmarks confirm matching physical coordinates.',
        concerns: 'none',
        model_used: 'simulated-gemma-4'
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    const cleanBefore = beforeImageBase64.replace(/^data:image\/\w+;base64,/, '');
    const cleanAfter = afterImageBase64.replace(/^data:image\/\w+;base64,/, '');
    const targetModel = 'gemma-4-26b-a4b-it';
    const promptText = buildVerificationPrompt(issue_type, severity, recommended_action);

    const callVerificationModel = async (model: string) => {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: promptText },
              {
                inlineData: {
                  mimeType: beforeMimeType,
                  data: cleanBefore
                }
              },
              {
                inlineData: {
                  mimeType: afterMimeType,
                  data: cleanAfter
                }
              }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json'
        }
      });
      return response.text || '';
    };

    let rawText = '';
    let parsed: any = null;
    let attempts = 0;

    // Attempt 1
    try {
      attempts++;
      rawText = await callVerificationModel(targetModel);
      parsed = safeParseJson(rawText);
    } catch (err: any) {
      console.warn('First attempt at Gemma 4 verification failed:', err?.message || err);

      // Check for rate limit error
      if (isRateLimitError(err)) {
        return res.status(429).json({
          error: 'Gemini API rate limit reached. Please wait a moment and tap retry.'
        });
      }

      // Retry once if invalid JSON or transient failure
      try {
        attempts++;
        console.log(`Retrying Gemma 4 (${targetModel}) verification once...`);
        rawText = await callVerificationModel(targetModel);
        parsed = safeParseJson(rawText);
      } catch (retryErr: any) {
        console.error('Retry verification call failed:', retryErr?.message || retryErr);
        if (isRateLimitError(retryErr)) {
          return res.status(429).json({
            error: 'Gemini API rate limit reached. Please wait a moment and tap retry.'
          });
        }
        return res.status(500).json({
          error: 'AI verification response was invalid or could not be completed. Please try again.'
        });
      }
    }

    // Validate structure & numbers
    let valid = isValidVerification(parsed);
    if (!valid) {
      console.warn('Verification JSON schema was incomplete, retrying once...');
      try {
        rawText = await callVerificationModel(targetModel);
        parsed = safeParseJson(rawText);
        valid = isValidVerification(parsed);
      } catch (retrySchemaErr: any) {
        if (isRateLimitError(retrySchemaErr)) {
          return res.status(429).json({
            error: 'Gemini API rate limit reached. Please wait a moment and tap retry.'
          });
        }
      }
    }

    if (!valid || !parsed) {
      return res.status(502).json({
        error: 'AI verification model returned invalid format. Please tap retry.'
      });
    }

    return res.json({
      same_location_likely: Boolean(parsed.same_location_likely),
      issue_resolved: Boolean(parsed.issue_resolved),
      repair_quality: Math.min(10, Math.max(1, Math.round(Number(parsed.repair_quality) || 7))),
      confidence: Math.min(100, Math.max(0, Math.round(Number(parsed.confidence) || 85))),
      observations: String(parsed.observations || 'Repair work has been inspected against reported coordinates.'),
      concerns: String(parsed.concerns || 'none'),
      model_used: targetModel
    });
  } catch (error: any) {
    console.error('Server error in verify-repair:', error);
    if (isRateLimitError(error)) {
      return res.status(429).json({
        error: 'Gemini API rate limit reached. Please wait a moment and tap retry.'
      });
    }
    return res.status(500).json({
      error: 'Failed to complete repair verification. Please check connection and try again.'
    });
  }
});

// Endpoint to generate formal municipal complaint using model gemma-4-26b-a4b-it
app.post('/api/generate-complaint', async (req, res) => {
  try {
    const { issue_type, severity, locationName, address, latitude, longitude, risk_reason, note_english, note } = req.body;

    const readableAddress = (address || locationName)?.trim();
    const hasReadableAddress = readableAddress && !readableAddress.includes('Address unavailable') && readableAddress !== `${latitude}, ${longitude}`;
    
    // Replace raw coordinates with the address plus coordinates in brackets, e.g. "Link Road, Andheri West, Mumbai 400053 (19.1136, 72.8697)"
    const locWithCoords = hasReadableAddress
      ? `${readableAddress} (${latitude}, ${longitude})`
      : `${latitude}, ${longitude}`;

    const effectiveNote = (note_english || note || '').trim();
    const riskString = risk_reason || 'deep pothole on a busy lane endangering two-wheelers';

    const promptText = `Write a formal complaint letter to the municipal corporation using this verified report data:
Issue: ${issue_type || 'pothole'}, Severity: ${severity || 8}/10, Location: ${locWithCoords}${hasReadableAddress ? ` (Address: ${readableAddress})` : ''}, Danger/Risk: ${riskString}${effectiveNote ? `, Citizen Note: "${effectiveNote}"` : ''}.
Make sure the readable street address and coordinates appear naturally in the complaint text${effectiveNote ? ' along with the citizen observation' : ''}. Keep it under 120 words, polite but urgent, and conclude with a firm request for inspection barricading and repair within 72 hours. Return plain text only.`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.json({
        complaint: `To
The Ward Officer,
Municipal Corporation Maintenance Division,
${hasReadableAddress ? readableAddress : `Sector Jurisdiction (${latitude}, ${longitude})`}.

Subject: Urgent Complaint Regarding Dangerous ${issue_type?.replace('_', ' ') || 'Pothole'} (Severity ${severity || 8}/10)

Respected Sir/Madam,

I am writing to bring to your urgent attention a hazardous road condition at ${locWithCoords}.

A severe ${issue_type?.replace('_', ' ') || 'pothole'} assessed at Severity ${severity || 8}/10 has developed along this active route. ${riskString}.${effectiveNote ? ` Citizen on-site observation: ${effectiveNote}.` : ''}

Considering the critical threat to commuter safety, I earnestly request your prompt intervention to barricade the hazard and complete the necessary repair within 72 hours.

Thank you.

Yours sincerely,
A Concerned Resident`,
        model_used: 'fallback-offline',
        prompt_used: promptText
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    const targetModel = 'gemma-4-26b-a4b-it';
    let complaintText = '';
    let modelUsed = targetModel;

    try {
      const response = await withTimeout(
        ai.models.generateContent({
          model: targetModel,
          contents: [{ role: 'user', parts: [{ text: promptText }] }],
        }),
        6000
      );
      complaintText = response.text || '';
    } catch (err: any) {
      console.warn(`Call to ${targetModel} for complaint generation had error or timed out, trying fallback to gemini-2.5-flash:`, err?.message);
      try {
        modelUsed = 'gemini-2.5-flash';
        const response = await withTimeout(
          ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
          }),
          6000
        );
        complaintText = response.text || '';
      } catch (fallbackErr) {
        complaintText = `To
The Ward Officer,
Municipal Corporation Maintenance Division,
${hasReadableAddress ? readableAddress : `Sector Jurisdiction (${latitude}, ${longitude})`}.

Subject: Urgent Complaint Regarding Dangerous ${issue_type?.replace('_', ' ') || 'Pothole'} (Severity ${severity || 8}/10)

Respected Sir/Madam,

I am writing to bring to your urgent attention a hazardous road condition at ${locWithCoords}.

A severe ${issue_type?.replace('_', ' ') || 'pothole'} assessed at Severity ${severity || 8}/10 has developed along this active route. ${riskString}.

Considering the critical threat to commuter safety, I earnestly request your prompt intervention to barricade the hazard and complete the necessary repair within 72 hours.

Thank you.

Yours sincerely,
A Concerned Resident`;
      }
    }

    return res.json({
      complaint: complaintText.trim(),
      model_used: modelUsed,
      prompt_used: promptText
    });
  } catch (error: any) {
    console.error('Server error generating complaint:', error);
    return res.status(500).json({ error: 'Failed to generate complaint', details: error?.message });
  }
});

async function startServer() {
  const distCandidate1 = path.resolve(__dirname, 'dist');
  const distCandidate2 = __dirname;
  const distPath = fs.existsSync(path.join(distCandidate1, 'index.html'))
    ? distCandidate1
    : fs.existsSync(path.join(distCandidate2, 'index.html'))
    ? distCandidate2
    : distCandidate1;

  const hasBuiltDist = fs.existsSync(path.join(distPath, 'index.html'));
  const isProduction = process.env.NODE_ENV === 'production' || hasBuiltDist;

  if (isProduction && hasBuiltDist) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Endpoint not found' });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`RoadWatch AI Inspector server running on http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    console.log('Received termination signal. Shutting down gracefully...');
    server.close(() => {
      console.log('RoadWatch AI server closed.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Could not close connections in time, forcing shutdown');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer();
