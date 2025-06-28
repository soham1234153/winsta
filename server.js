const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

// ✅ Supabase Setup
const supabaseUrl = 'https://ruyifxiaxujbwaozrqga.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ1eWlmeGlheHVqYndhb3pycWdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5NDE4NjQsImV4cCI6MjA2NjUxNzg2NH0.5maeCzmlj1Y3bTw0iXM4z_MvxmMEf3tI4SqgmIw8S6o';
const supabase = createClient(supabaseUrl, supabaseKey);

// ✅ Fast2SMS API Key
const FAST2SMS_API_KEY = 'Jt747A7UPWXDd3wmOV8RT2HQf202r1B6J0zay6Ta1bPdZRPD26Jxbm1wC0zZ';

// ✅ OTP Store (temporary in memory)
let otpStore = {};

// ✅ Send OTP for Registration
app.post('/send-otp-register', async (req, res) => {
  const { name, mobile } = req.body;

  // ✅ Check duplicate number
  const { data: existingUser } = await supabase
    .from('users')
    .select('mobile')
    .eq('mobile', mobile);

  if (existingUser.length > 0) {
    return res.json({ success: false, message: '❌ Number already registered! Please login.' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000);
  otpStore[mobile] = otp;
  otpStore[mobile + '_name'] = name;

  console.log(`OTP for registration ${mobile}: ${otp}`);

  await sendOtpSms(mobile, otp, name);
  res.json({ success: true, message: '✅ OTP sent for registration!' });
});

// ✅ Send OTP for Login
app.post('/send-otp-login', async (req, res) => {
  const { mobile } = req.body;

  const { data: userFound } = await supabase
    .from('users')
    .select('mobile')
    .eq('mobile', mobile);

  if (!userFound || userFound.length === 0) {
    return res.json({ success: false, message: '❌ Number not found! Please register first.' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000);
  otpStore[mobile] = otp;

  console.log(`OTP for login ${mobile}: ${otp}`);
  await sendOtpSms(mobile, otp, 'User');

  res.json({ success: true, message: '✅ OTP sent for login!' });
});

// ✅ Verify OTP for Registration
app.post('/verify-otp-register', async (req, res) => {
  const { mobile, otp } = req.body;

  if (otpStore[mobile] && otpStore[mobile] == otp) {
    const name = otpStore[mobile + '_name'];

    const { error } = await supabase
      .from('users')
      .insert([{ name, mobile }]);

    delete otpStore[mobile];
    delete otpStore[mobile + '_name'];

    if (error) {
      console.error(error);
      return res.json({ success: false, message: '❌ OTP verified but user save failed!' });
    }

    res.json({ success: true, message: '✅ Registration successful!' });
  } else {
    res.json({ success: false, message: '❌ Invalid OTP!' });
  }
});

// ✅ Verify OTP for Login
app.post('/verify-otp-login', async (req, res) => {
  const { mobile, otp } = req.body;

  if (otpStore[mobile] && otpStore[mobile] == otp) {
    delete otpStore[mobile];

    // ✅ Get user name from users table
    const { data: userData, error } = await supabase
      .from('users')
      .select('name')
      .eq('mobile', mobile)
      .single();

    if (error || !userData) {
      return res.json({ success: false, message: 'Login verified but user fetch failed!' });
    }

    res.json({ success: true, message: "✅ Login successful!", name: userData.name });
  } else {
    res.json({ success: false, message: "❌ Invalid OTP!" });
  }
});



// ✅ Transaction Submission - Save into user + respective card table
app.post('/save-transaction', async (req, res) => {
  const { name, mobile, cardId, txnId } = req.body;

  try {
    // ✅ Step 1: Get user info
    const { data: userRow, error: userFetchError } = await supabase
      .from('users')
      .select('id, participated_cards')
      .eq('mobile', mobile)
      .single();

    if (userFetchError || !userRow) {
      return res.json({ success: false, message: '❌ User not found!' });
    }

    const userId = userRow.id;

    // ✅ Step 2: Update user's participated_cards
    let cards = userRow.participated_cards || [];
    if (!cards.includes(cardId)) {
      cards.push(cardId);
      await supabase
        .from('users')
        .update({ participated_cards: cards })
        .eq('id', userId);
    }

    // ✅ Step 3: Insert into correct card table
    let tableName = '';
    if (cardId === 'Card1') tableName = 'card1_participants';
    else if (cardId === 'Card2') tableName = 'card2_participants';
    else if (cardId === 'Card3') tableName = 'card3_participants';
    else return res.json({ success: false, message: '❌ Invalid Card ID' });

    const { error: insertError } = await supabase
      .from(tableName)
      .insert({
        user_id: userId,
        user_name: name,
        txn_id: txnId
      });

    if (insertError) throw insertError;

    res.json({ success: true, message: '✅ Transaction Saved!' });

  } catch (error) {
    console.error('Supabase Error:', error);
    res.json({ success: false, message: '❌ Server Error! Try again.' });
  }
});

// ✅ Fast2SMS Function
async function sendOtpSms(mobile, otp, name) {
  const message = `Hey ${name}! 👋 Your OTP for verification is: ${otp}. Please do not share it with anyone.`;

  const payload = {
    route: "q",              
    message: message,
    language: "english",
    numbers: mobile
  };

  try {
    const response = await axios.post('https://www.fast2sms.com/dev/bulkV2', payload, {
      headers: {
        authorization: FAST2SMS_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('SMS API Response:', response.data);
  } catch (error) {
    console.error('Fast2SMS Error:', error.response ? error.response.data : error.message);
  }
}

// ✅ Start Server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
