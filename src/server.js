require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const connectDB = require('./db');

// Models
const User = require('./models/User');
const HealthCenter = require('./models/HealthCenter');
const DailyReport = require('./models/DailyReport');
const AuditLog = require('./models/AuditLog');
const BytLinkage = require('./models/BytLinkage');

// Middleware
const { requireAuth, requireRole } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection will be initiated before starting the server

// Express configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.urlencoded({ extended: true }));

// Load and base64-encode custom TTF font for download/canvas exports
const fontPath = path.join(__dirname, '../public/css/MomoTrustDisplay-Regular.ttf');
const momoFontBase64 = fs.existsSync(fontPath) ? fs.readFileSync(fontPath).toString('base64') : '';
app.use(express.json());

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'syt_health_check_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    secure: false // true if HTTPS
  }
}));

// Global views variable helper
app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.path = req.path;
  next();
});

// Helper for date normalization
function parseDateUTC(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateString(dateObj) {
  if (!dateObj) return '';
  const d = new Date(dateObj);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// -------------------------------------------------------------
// SVG COMPILATION HELPER
// -------------------------------------------------------------
async function compileReportSvg(dateStr) {
  const selectedDate = parseDateUTC(dateStr);
  const dateString = `${String(selectedDate.getUTCDate()).padStart(2, '0')}/${String(selectedDate.getUTCMonth() + 1).padStart(2, '0')}/${selectedDate.getUTCFullYear()}`;

  const startDate = parseDateUTC('2026-07-01');
  const cumulativeMatchLimit = selectedDate;

  // Fetch all unit users sorted by name
  const units = await User.find({ role: 'unit' }).sort({ unitName: 1 });

  // Aggregate statistics for selected date (daily)
  const dailyAgg = await DailyReport.aggregate([
    { $match: { date: selectedDate } },
    {
      $group: {
        _id: '$unitId',
        under6: { $sum: '$under6' },
        from6To18: { $sum: '$from6To18' },
        over18: { $sum: '$over18' },
        total: { $sum: { $add: ['$under6', '$from6To18', '$over18'] } },
        adminUnder6: { $sum: '$adminUnder6' },
        adminFrom6To18: { $sum: '$adminFrom6To18' },
        adminOver18: { $sum: '$adminOver18' },
        adminTotal: { $sum: { $add: ['$adminUnder6', '$adminFrom6To18', '$adminOver18'] } }
      }
    }
  ]);

  // Aggregate statistics for cumulative up to selected date
  const cumulativeAgg = await DailyReport.aggregate([
    { $match: { date: { $gte: startDate, $lte: cumulativeMatchLimit } } },
    {
      $group: {
        _id: '$unitId',
        under6: { $sum: '$under6' },
        from6To18: { $sum: '$from6To18' },
        over18: { $sum: '$over18' },
        total: { $sum: { $add: ['$under6', '$from6To18', '$over18'] } },
        adminUnder6: { $sum: '$adminUnder6' },
        adminFrom6To18: { $sum: '$adminFrom6To18' },
        adminOver18: { $sum: '$adminOver18' },
        adminTotal: { $sum: { $add: ['$adminUnder6', '$adminFrom6To18', '$adminOver18'] } }
      }
    }
  ]);

  let dailyWorkplaceTotal = 0;
  const dailyMap = {};
  dailyAgg.forEach(item => {
    if (item._id) {
      dailyMap[item._id.toString()] = item;
    } else {
      dailyWorkplaceTotal = item.adminTotal || 0;
    }
  });

  let cumulativeWorkplaceTotal = 0;
  const cumulativeMap = {};
  cumulativeAgg.forEach(item => {
    if (item._id) {
      cumulativeMap[item._id.toString()] = item;
    } else {
      cumulativeWorkplaceTotal = item.adminTotal || 0;
    }
  });

  let grandDailyTotal = 0;
  let grandCumulativeTotal = 0;
  let grandFirstHalfTotal = 833233;
  let grandTargetTotal = 0;
  let grandResidentPopulation = 0;

  const reportsTable = [];
  units.forEach(unit => {
    const uId = unit._id.toString();
    const dailyVal = dailyMap[uId] ? dailyMap[uId].total : 0;
    const cumulativeVal = cumulativeMap[uId] ? cumulativeMap[uId].total : 0;

    reportsTable.push({
      unitName: unit.unitName,
      daily: dailyVal,
      cumulative: cumulativeVal
    });

    grandDailyTotal += dailyVal;
    grandCumulativeTotal += cumulativeVal;
    grandTargetTotal += (unit.planTarget || 0);
    grandResidentPopulation += (unit.residentPopulation || 0);
  });

  // Fetch BYT Linkage count for this date and cumulative
  const bytTodayObj = await BytLinkage.findOne({ date: selectedDate }) || { count: 0 };
  const grandBytToday = bytTodayObj.count || 0;

  const bytLuyKeAgg = await BytLinkage.aggregate([
    { $match: { date: { $lte: selectedDate } } },
    { $group: { _id: null, total: { $sum: '$count' } } }
  ]);
  const grandBytLuyKe = bytLuyKeAgg.length > 0 ? bytLuyKeAgg[0].total : 0;

  const grandOverallTotal = grandCumulativeTotal + grandFirstHalfTotal + cumulativeWorkplaceTotal;
  const progressRateOverall = grandResidentPopulation > 0 ? (grandOverallTotal / grandResidentPopulation) * 100 : 0;
  const progressRateCampaign = grandTargetTotal > 0 ? (grandCumulativeTotal / grandTargetTotal) * 100 : 0;

  // Generate the SVG dynamic text nodes for the 96 communes
  let dynamicTexts = '';
  for (let i = 0; i < 96; i++) {
    const unit = reportsTable[i];
    if (!unit) continue;

    const col = Math.floor(i / 32); // Columns: 0, 1, 2
    const row = i % 32;

    let xName = 220;
    let xDaily = 584;
    let xCumulative = 707;
    let xStt = 143;

    if (col === 1) {
      xName = 1003;
      xDaily = 1366;
      xCumulative = 1494;
      xStt = 920;
    } else if (col === 2) {
      xName = 1786;
      xDaily = 2151;
      xCumulative = 2260;
      xStt = 1703;
    }

    const yName = 1175.75 + row * 51;
    const yVal = 1176.75 + row * 51;

    const escapeXml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const name = escapeXml(unit.unitName);
    const daily = unit.daily.toLocaleString('vi-VN');
    const cumulative = unit.cumulative.toLocaleString('vi-VN');
    const stt = String(i + 1);

    dynamicTexts += `<text fill="black" style="white-space: pre" xml:space="preserve" font-family="Momo Trust Display Web" font-size="30" letter-spacing="0em"><tspan x="${xName}" y="${yName}">${name}</tspan></text>\n`;
    dynamicTexts += `<text fill="black" style="white-space: pre" xml:space="preserve" font-family="Momo Trust Display Web" font-size="30" letter-spacing="0em"><tspan x="${xDaily}" y="${yVal}">${daily}</tspan></text>\n`;
    dynamicTexts += `<text fill="black" style="white-space: pre" xml:space="preserve" font-family="Momo Trust Display Web" font-size="30" letter-spacing="0em"><tspan x="${xCumulative}" y="${yVal}">${cumulative}</tspan></text>\n`;
    dynamicTexts += `<text fill="black" style="white-space: pre" xml:space="preserve" font-family="Momo Trust Display Web" font-size="30" letter-spacing="0em"><tspan x="${xStt}" y="${yVal}">${stt}</tspan></text>\n`;
  }

  // Read templates and replace variables
  let template = fs.readFileSync(path.join(__dirname, '../views/report_template.svg'), 'utf8');
  
  // Replace dynamic text elements
  template = template.replace('<!-- DYNAMIC_TEXT_ELEMENTS -->', dynamicTexts);
  
  // Replace top card counters using placeholders
  template = template.replace('%%GRAND_DAILY_TOTAL%%', grandDailyTotal.toLocaleString('vi-VN'));
  template = template.replace('%%GRAND_CUMULATIVE_TOTAL%%', grandCumulativeTotal.toLocaleString('vi-VN'));
  template = template.replace('%%GRAND_FIRST_HALF_TOTAL%%', grandFirstHalfTotal.toLocaleString('vi-VN'));
  template = template.replace('%%GRAND_OVERALL_TOTAL%%', grandOverallTotal.toLocaleString('vi-VN'));

  // Replace short parameters globally
  template = template.replace(/\{1\}/g, grandDailyTotal.toLocaleString('vi-VN'));
  template = template.replace(/\{2\}/g, grandCumulativeTotal.toLocaleString('vi-VN'));
  template = template.replace(/\{3\}/g, grandFirstHalfTotal.toLocaleString('vi-VN'));
  template = template.replace(/\{4\}/g, grandOverallTotal.toLocaleString('vi-VN'));
  template = template.replace(/\{5\}/g, grandResidentPopulation.toLocaleString('vi-VN'));
  template = template.replace(/\{6\}/g, progressRateOverall.toFixed(1) + '%');
  template = template.replace(/\{7\}/g, grandTargetTotal.toLocaleString('vi-VN'));
  template = template.replace(/\{8\}/g, grandBytToday.toLocaleString('vi-VN'));
  template = template.replace(/\{9\}/g, progressRateCampaign.toFixed(1) + '%');
  template = template.replace(/\{10\}/g, grandBytLuyKe.toLocaleString('vi-VN'));
  
  // Replace report date globally
  template = template.replace(/03\/07\/2026/g, dateString);

  return template;
}

// -------------------------------------------------------------
// ROUTES: A4 FIGMA REPORT GENERATOR
// -------------------------------------------------------------
app.get('/report', async (req, res) => {
  try {
    let date = req.query.date;
    if (!date) {
      const latestReport = await DailyReport.findOne().sort({ date: -1 });
      if (latestReport) {
        date = latestReport.date.toISOString().split('T')[0];
      } else {
        date = '2026-07-06';
      }
    }
    const svgContent = await compileReportSvg(date);
    return res.render('report', {
      date: date,
      svgContent: svgContent
    });
  } catch (err) {
    console.error('Report generation error:', err);
    return res.status(500).send('Lỗi tạo báo cáo: ' + err.message);
  }
});

app.get('/download-report', async (req, res) => {
  try {
    let date = req.query.date;
    if (!date) {
      const latestReport = await DailyReport.findOne().sort({ date: -1 });
      if (latestReport) {
        date = latestReport.date.toISOString().split('T')[0];
      } else {
        date = '2026-07-06';
      }
    }
    const svgContent = await compileReportSvg(date);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `attachment; filename="bao-cao-syt-figma-${date}.svg"`);
    return res.send(svgContent);
  } catch (err) {
    console.error('Report download error:', err);
    return res.status(500).send('Lỗi tải báo cáo: ' + err.message);
  }
});

// -------------------------------------------------------------
// ROUTES: AUTHENTICATION
// -------------------------------------------------------------

app.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');
  }
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (!user) {
      return res.render('login', { error: 'Tên đăng nhập không đúng' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('login', { error: 'Mật khẩu không đúng' });
    }

    // Set session
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    req.session.userRole = user.role;
    req.session.unitName = user.unitName;

    return res.redirect('/');
  } catch (error) {
    console.error('Login error:', error);
    return res.render('login', { error: 'Đã xảy ra lỗi hệ thống' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// -------------------------------------------------------------
// ROUTES: DASHBOARD
// -------------------------------------------------------------

app.get('/', async (req, res) => {
  try {
    // Current date default to 2026-07-06 if in range, otherwise 2026-07-01
    let defaultDate = '2026-07-06';
    const now = new Date();
    // Check if current system date is between July 1st and Sept 30th (of 2026)
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    if (year === 2026 && month >= 7 && month <= 9) {
      defaultDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    let queryDateStr;
    if (req.query.hasOwnProperty('date')) {
      queryDateStr = req.query.date;
    } else {
      queryDateStr = defaultDate;
    }

    const selectedDate = (queryDateStr && queryDateStr !== "") ? parseDateUTC(queryDateStr) : null;
    
    // Date bounds for checking
    const startDate = parseDateUTC('2026-07-01');
    const endDate = parseDateUTC('2026-09-30');
    const dailyMatchDate = selectedDate || parseDateUTC(defaultDate);
    const cumulativeMatchLimit = selectedDate || endDate;

    // Aggregate statistics for selected date (daily)
    const dailyAgg = await DailyReport.aggregate([
      { $match: { date: dailyMatchDate } },
      {
        $group: {
          _id: '$unitId',
          // Commune entered counts
          under6: { $sum: '$under6' },
          from6To18: { $sum: '$from6To18' },
          over18: { $sum: '$over18' },
          total: { $sum: { $add: ['$under6', '$from6To18', '$over18'] } },
          // Admin entered counts
          adminUnder6: { $sum: '$adminUnder6' },
          adminFrom6To18: { $sum: '$adminFrom6To18' },
          adminOver18: { $sum: '$adminOver18' },
          adminTotal: { $sum: { $add: ['$adminUnder6', '$adminFrom6To18', '$adminOver18'] } }
        }
      }
    ]);

    const cumulativeAgg = await DailyReport.aggregate([
      { $match: { date: { $gte: startDate, $lte: cumulativeMatchLimit } } },
      {
        $group: {
          _id: '$unitId',
          // Commune entered cumulative
          under6: { $sum: '$under6' },
          from6To18: { $sum: '$from6To18' },
          over18: { $sum: '$over18' },
          total: { $sum: { $add: ['$under6', '$from6To18', '$over18'] } },
          // Admin entered cumulative
          adminUnder6: { $sum: '$adminUnder6' },
          adminFrom6To18: { $sum: '$adminFrom6To18' },
          adminOver18: { $sum: '$adminOver18' },
          adminTotal: { $sum: { $add: ['$adminUnder6', '$adminFrom6To18', '$adminOver18'] } }
        }
      }
    ]);

    // Convert arrays to hash maps
    const dailyMap = {};
    let dailyWorkplaceUnder6 = 0;
    let dailyWorkplaceFrom6To18 = 0;
    let dailyWorkplaceOver18 = 0;
    let dailyWorkplaceTotal = 0;
    dailyAgg.forEach(item => {
      if (item._id) {
        dailyMap[item._id.toString()] = item;
      } else {
        dailyWorkplaceUnder6 = item.adminUnder6 || 0;
        dailyWorkplaceFrom6To18 = item.adminFrom6To18 || 0;
        dailyWorkplaceOver18 = item.adminOver18 || 0;
        dailyWorkplaceTotal = item.adminTotal || 0;
      }
    });

    const cumulativeMap = {};
    let cumulativeWorkplaceUnder6 = 0;
    let cumulativeWorkplaceFrom6To18 = 0;
    let cumulativeWorkplaceOver18 = 0;
    let cumulativeWorkplaceTotal = 0;
    cumulativeAgg.forEach(item => {
      if (item._id) {
        cumulativeMap[item._id.toString()] = item;
      } else {
        cumulativeWorkplaceUnder6 = item.adminUnder6 || 0;
        cumulativeWorkplaceFrom6To18 = item.adminFrom6To18 || 0;
        cumulativeWorkplaceOver18 = item.adminOver18 || 0;
        cumulativeWorkplaceTotal = item.adminTotal || 0;
      }
    });

    const monthlyAgg = await DailyReport.aggregate([
      { $match: { date: { $gte: startDate, $lte: cumulativeMatchLimit } } },
      {
        $project: {
          unitId: 1,
          month: { $month: '$date' },
          under6: 1,
          from6To18: 1,
          over18: 1,
          adminUnder6: 1,
          adminFrom6To18: 1,
          adminOver18: 1
        }
      },
      {
        $group: {
          _id: { unitId: '$unitId', month: '$month' },
          under6: { $sum: '$under6' },
          from6To18: { $sum: '$from6To18' },
          over18: { $sum: '$over18' },
          adminUnder6: { $sum: '$adminUnder6' },
          adminFrom6To18: { $sum: '$adminFrom6To18' },
          adminOver18: { $sum: '$adminOver18' }
        }
      }
    ]);

    const monthlyMap = {};
    const monthlyWorkplace = {
      7: { under6: 0, from6To18: 0, over18: 0, adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0 },
      8: { under6: 0, from6To18: 0, over18: 0, adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0 },
      9: { under6: 0, from6To18: 0, over18: 0, adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0 }
    };
    monthlyAgg.forEach(item => {
      const month = item._id.month; // 7, 8, or 9
      if (!item._id.unitId) {
        if (month === 7 || month === 8 || month === 9) {
          monthlyWorkplace[month] = {
            under6: item.under6 || 0,
            from6To18: item.from6To18 || 0,
            over18: item.over18 || 0,
            adminUnder6: item.adminUnder6 || 0,
            adminFrom6To18: item.adminFrom6To18 || 0,
            adminOver18: item.adminOver18 || 0
          };
        }
        return;
      }
      const uId = item._id.unitId.toString();
      if (!monthlyMap[uId]) {
        monthlyMap[uId] = {
          7: { under6: 0, from6To18: 0, over18: 0, adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0 },
          8: { under6: 0, from6To18: 0, over18: 0, adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0 },
          9: { under6: 0, from6To18: 0, over18: 0, adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0 }
        };
      }
      if (month === 7 || month === 8 || month === 9) {
        monthlyMap[uId][month] = {
          under6: item.under6 || 0,
          from6To18: item.from6To18 || 0,
          over18: item.over18 || 0,
          adminUnder6: item.adminUnder6 || 0,
          adminFrom6To18: item.adminFrom6To18 || 0,
          adminOver18: item.adminOver18 || 0
        };
      }
    });

    // Fetch all units
    const units = await User.find({ role: 'unit' }).sort({ unitName: 1 });

    // Build the reporting table
    const reportsTable = [];
    let grandDaily = { under6: 0, from6To18: 0, over18: 0, total: 0 };
    let grandCumulative = { under6: 0, from6To18: 0, over18: 0, total: 0 };
    
    let grandAdminDaily = { under6: 0, from6To18: 0, over18: 0, total: 0 };
    let grandAdminCumulative = { under6: 0, from6To18: 0, over18: 0, total: 0 };

    let grandTarget = 0;
    let grandResidentPopulation = 0;
    let grandFirstHalfChecked = 833233;

    let grandMonthly = {
      7: { under6: 0, from6To18: 0, over18: 0, adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0 },
      8: { under6: 0, from6To18: 0, over18: 0, adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0 },
      9: { under6: 0, from6To18: 0, over18: 0, adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0 }
    };

    units.forEach(unit => {
      const uId = unit._id.toString();
      
      // Commune data
      const daily = dailyMap[uId] || { under6: 0, from6To18: 0, over18: 0, total: 0 };
      const cumulative = cumulativeMap[uId] || { under6: 0, from6To18: 0, over18: 0, total: 0 };
      const yearCumulative = cumulative.total + unit.firstHalfChecked;
      const completionRate = unit.planTarget > 0 ? (yearCumulative / unit.planTarget) * 100 : 0;
      
      // Admin data
      const adminDaily = dailyMap[uId] ? {
        under6: dailyMap[uId].adminUnder6 || 0,
        from6To18: dailyMap[uId].adminFrom6To18 || 0,
        over18: dailyMap[uId].adminOver18 || 0,
        total: dailyMap[uId].adminTotal || 0
      } : { under6: 0, from6To18: 0, over18: 0, total: 0 };

      const adminCumulative = cumulativeMap[uId] ? {
        under6: cumulativeMap[uId].adminUnder6 || 0,
        from6To18: cumulativeMap[uId].adminFrom6To18 || 0,
        over18: cumulativeMap[uId].adminOver18 || 0,
        total: cumulativeMap[uId].adminTotal || 0
      } : { under6: 0, from6To18: 0, over18: 0, total: 0 };

      const adminYearCumulative = adminCumulative.total + unit.firstHalfChecked;
      const adminCompletionRate = unit.planTarget > 0 ? (adminYearCumulative / unit.planTarget) * 100 : 0;

      // Get monthly breakdown for this unit
      const uMonthly = monthlyMap[uId] || {
        7: { under6: 0, from6To18: 0, over18: 0, adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0 },
        8: { under6: 0, from6To18: 0, over18: 0, adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0 },
        9: { under6: 0, from6To18: 0, over18: 0, adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0 }
      };

      reportsTable.push({
        unitId: uId,
        unitName: unit.unitName,
        username: unit.username,
        planTarget: unit.planTarget,
        residentPopulation: unit.residentPopulation,
        firstHalfChecked: unit.firstHalfChecked,
        // Commune metrics
        daily,
        cumulative,
        yearCumulative,
        completionRate,
        // Admin metrics
        adminDaily,
        adminCumulative,
        adminYearCumulative,
        adminCompletionRate,
        // Monthly breakdown
        monthly: uMonthly
      });

      // Sum overall for grand stats
      grandDaily.under6 += daily.under6;
      grandDaily.from6To18 += daily.from6To18;
      grandDaily.over18 += daily.over18;
      grandDaily.total += daily.total;

      grandCumulative.under6 += cumulative.under6;
      grandCumulative.from6To18 += cumulative.from6To18;
      grandCumulative.over18 += cumulative.over18;
      grandCumulative.total += cumulative.total;

      // Admin overall sums
      grandAdminDaily.under6 += adminDaily.under6;
      grandAdminDaily.from6To18 += adminDaily.from6To18;
      grandAdminDaily.over18 += adminDaily.over18;
      grandAdminDaily.total += adminDaily.total;

      grandAdminCumulative.under6 += adminCumulative.under6;
      grandAdminCumulative.from6To18 += adminCumulative.from6To18;
      grandAdminCumulative.over18 += adminCumulative.over18;
      grandAdminCumulative.total += adminCumulative.total;

      grandTarget += unit.planTarget;
      grandResidentPopulation += unit.residentPopulation;

      // Sum monthly grand totals
      [7, 8, 9].forEach(m => {
        grandMonthly[m].under6 += uMonthly[m].under6;
        grandMonthly[m].from6To18 += uMonthly[m].from6To18;
        grandMonthly[m].over18 += uMonthly[m].over18;
        grandMonthly[m].adminUnder6 += uMonthly[m].adminUnder6;
        grandMonthly[m].adminFrom6To18 += uMonthly[m].adminFrom6To18;
        grandMonthly[m].adminOver18 += uMonthly[m].adminOver18;
      });
    });

    const isUserAdmin = req.session.userRole === 'admin';
    const displayDaily = grandDaily;
    const displayCumulative = grandCumulative;
    const displayYearCumulative = displayCumulative.total + grandFirstHalfChecked + cumulativeWorkplaceTotal;
    const displayOverallCompletionRate = grandTarget > 0 ? (displayYearCumulative / grandTarget) * 100 : 0;

    // Admin health centers data aggregation
    let adminCentersData = [];
    if (isUserAdmin) {
      const adminReports = await DailyReport.find({ adminWorkplace: { $ne: '' } }).populate('centerId').populate('unitId');
      
      const centerGroups = {};
      adminReports.forEach(r => {
        if (!r.centerId) return;
        const cId = r.centerId._id.toString();
        if (!centerGroups[cId]) {
          centerGroups[cId] = {
            centerName: r.centerId.name,
            unitName: r.unitId ? r.unitId.unitName : '-',
            workplaces: [],
            workers: 0,
            children: 0,
            political: 0,
            others: 0,
            total: 0
          };
        }
        if (r.adminWorkplace && !centerGroups[cId].workplaces.includes(r.adminWorkplace)) {
          centerGroups[cId].workplaces.push(r.adminWorkplace);
        }
        centerGroups[cId].workers += r.adminWorkers || 0;
        centerGroups[cId].children += r.adminChildren || 0;
        centerGroups[cId].political += r.adminPolitical || 0;
        centerGroups[cId].others += r.adminOthers || 0;
        centerGroups[cId].total += (r.adminWorkers || 0) + (r.adminChildren || 0) + (r.adminPolitical || 0) + (r.adminOthers || 0);
      });
      adminCentersData = Object.values(centerGroups);
    }

    // Unit-specific breakdown if unit user
    let unitStats = null;
    let unitCentersData = [];
    if (req.session.userRole === 'unit') {
      const currentUnitId = req.session.userId;
      const myUnit = await User.findById(currentUnitId);
      
      const myDaily = dailyMap[currentUnitId] || { under6: 0, from6To18: 0, over18: 0, total: 0 };
      const myCumulative = cumulativeMap[currentUnitId] || { under6: 0, from6To18: 0, over18: 0, total: 0 };
      
      const myYearCumulative = myCumulative.total + myUnit.firstHalfChecked;
      unitStats = {
        unitName: myUnit.unitName,
        planTarget: myUnit.planTarget,
        residentPopulation: myUnit.residentPopulation,
        firstHalfChecked: myUnit.firstHalfChecked,
        yearCumulative: myYearCumulative,
        daily: myDaily,
        cumulative: myCumulative,
        completionRate: myUnit.planTarget > 0 ? (myYearCumulative / myUnit.planTarget) * 100 : 0
      };

      // Get breakdown for each health center under this unit (commune's own inputs)
      const centers = await HealthCenter.find({ unitId: currentUnitId });
      const centerDailyReports = await DailyReport.find({ date: dailyMatchDate, unitId: currentUnitId });
      const centerCumulativeReports = await DailyReport.find({ 
        date: { $gte: startDate, $lte: cumulativeMatchLimit }, 
        unitId: currentUnitId 
      });

      centers.forEach(center => {
        const cId = center._id.toString();
        
        // daily for this center
        const cDailyReport = centerDailyReports.find(r => r.centerId.toString() === cId);
        const cDaily = cDailyReport ? {
          under6: cDailyReport.under6,
          from6To18: cDailyReport.from6To18,
          over18: cDailyReport.over18,
          total: cDailyReport.under6 + cDailyReport.from6To18 + cDailyReport.over18
        } : { under6: 0, from6To18: 0, over18: 0, total: 0 };

        // cumulative for this center
        let cCum = { under6: 0, from6To18: 0, over18: 0, total: 0 };
        centerCumulativeReports.forEach(r => {
          if (r.centerId.toString() === cId) {
            cCum.under6 += r.under6;
            cCum.from6To18 += r.from6To18;
            cCum.over18 += r.over18;
            cCum.total += r.under6 + r.from6To18 + r.over18;
          }
        });

        unitCentersData.push({
          centerName: center.name,
          daily: cDaily,
          cumulative: cCum
        });
      });
    }

    // Top 5 units and Bottom 5 units for Chart visualization
    const sortedByCompletion = [...reportsTable].sort((a, b) => {
      const rateA = isUserAdmin ? a.adminCompletionRate : a.completionRate;
      const rateB = isUserAdmin ? b.adminCompletionRate : b.completionRate;
      return rateB - rateA;
    });
    const topUnits = sortedByCompletion.slice(0, 5).map(u => ({
      ...u,
      completionRate: isUserAdmin ? u.adminCompletionRate : u.completionRate
    }));
    
    // Daily progress timeline (aggregate daily total counts from 01/07 to endDate)
    const dailyProgressAgg = await DailyReport.aggregate([
      { $match: { date: { $gte: startDate, $lte: endDate } } },
      {
        $group: {
          _id: '$date',
          total: { $sum: { $add: ['$under6', '$from6To18', '$over18'] } },
          adminTotal: { $sum: { $add: ['$adminUnder6', '$adminFrom6To18', '$adminOver18'] } },
          workplaceTotal: {
            $sum: {
              $cond: [
                { $ne: ['$adminWorkplace', ''] },
                { $add: ['$adminWorkers', '$adminChildren', '$adminPolitical', '$adminOthers'] },
                0
              ]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Formatting progress timeline data
    const progressTimelineLabels = [];
    const progressTimelineData = [];
    let rollingSum = 0;
    
    // To ensure a continuous timeline, loop through the days in range up to endDate
    let loopDate = new Date(startDate);
    while (loopDate <= endDate) {
      const formattedDate = formatDateString(loopDate);
      const dayData = dailyProgressAgg.find(d => formatDateString(d._id) === formattedDate);
      const dayTotal = dayData ? (isUserAdmin ? dayData.adminTotal : dayData.total) : 0;
      rollingSum += dayTotal;
      
      const dayStr = loopDate.getUTCDate() + '/' + String(loopDate.getUTCMonth() + 1).padStart(2, '0');
      progressTimelineLabels.push(dayStr);
      progressTimelineData.push(rollingSum);
      
      loopDate.setUTCDate(loopDate.getUTCDate() + 1);
    }

    // Fetch all daily reports for the grid mapping
    const allDailyReports = await DailyReport.find({
      date: { $gte: startDate, $lte: endDate }
    });

    const dailyGridMap = {};
    allDailyReports.forEach(r => {
      if (!r.unitId) return; // Skip workplace KSK reports since they don't map to a specific unit grid
      const uId = r.unitId.toString();
      const dStr = formatDateString(r.date);
      if (!dailyGridMap[uId]) {
        dailyGridMap[uId] = {};
      }
      dailyGridMap[uId][dStr] = {
        total: r.under6 + r.from6To18 + r.over18,
        adminTotal: r.adminUnder6 + r.adminFrom6To18 + r.adminOver18
      };
    });

    const campaignDays = [];
    let gridLoopDate = new Date(startDate);
    while (gridLoopDate <= endDate) {
      campaignDays.push({
        dateStr: formatDateString(gridLoopDate),
        dateDisplay: gridLoopDate.getUTCDate() + '/' + String(gridLoopDate.getUTCMonth() + 1).padStart(2, '0')
      });
      gridLoopDate.setUTCDate(gridLoopDate.getUTCDate() + 1);
    }

    const dayProvinceMap = {};
    dailyProgressAgg.forEach(d => {
      dayProvinceMap[formatDateString(d._id)] = d;
    });

    // Generate the SVG report for the dashboard
    const svgContent = await compileReportSvg(formatDateString(dailyMatchDate));

    res.render('dashboard', {
      momoFontBase64,
      campaignDays,
      dailyGridMap,
      dayProvinceMap,
      svgContent,
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.userRole,
        unitName: req.session.unitName
      },
      selectedDateStr: queryDateStr,
      dailyMatchDateStr: formatDateString(dailyMatchDate),
      isUserAdmin,
      grandDaily: displayDaily,
      grandCumulative: displayCumulative,
      grandTarget,
      grandResidentPopulation,
      grandFirstHalfChecked,
      grandYearCumulative: displayYearCumulative,
      overallCompletionRate: displayOverallCompletionRate,
      reportsTable,
      grandMonthly,
      unitStats,
      unitCentersData,
      adminCentersData,
      topUnits,
      progressTimelineLabels: JSON.stringify(progressTimelineLabels),
      progressTimelineData: JSON.stringify(progressTimelineData)
    });
  } catch (error) {
    console.error('Dashboard Error:', error);
    res.status(500).send('Lỗi máy chủ khi tải trang tổng quan');
  }
});

// -------------------------------------------------------------
// ROUTES: DATA INPUT & HEALTH CENTERS
// -------------------------------------------------------------

app.get('/input', requireAuth, async (req, res) => {
  try {
    // Current date default to 2026-07-06 if in range, otherwise 2026-07-01
    let defaultDate = '2026-07-06';
    const now = new Date();
    if (now.getFullYear() === 2026 && (now.getMonth() + 1) >= 7 && (now.getMonth() + 1) <= 9) {
      defaultDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    const queryDateStr = req.query.date || defaultDate;
    const selectedDate = parseDateUTC(queryDateStr);

    // List of units for Admin dropdown selector
    const units = req.session.userRole === 'admin' ? await User.find({ role: 'unit' }).sort({ unitName: 1 }) : [];

    let selectedUnitId = req.session.userId;
    if (req.session.userRole === 'admin') {
      if (req.query.unitId) {
        selectedUnitId = req.query.unitId;
      } else if (units.length > 0) {
        selectedUnitId = units[0]._id.toString();
      }
    }

    // Load centers for selected unit
    const centers = await HealthCenter.find({ unitId: selectedUnitId }).sort({ name: 1 });
    const allCenters = req.session.userRole === 'admin' ? await HealthCenter.find().sort({ name: 1 }) : [];
    
    // Load daily reports for this date and unit (or all dates and workplace reports for admin)
    const reports = req.session.userRole === 'admin'
      ? await DailyReport.find({
          $or: [
            { unitId: selectedUnitId },
            { adminWorkplace: { $ne: '', $ne: null } }
          ]
        }).populate('centerId').sort({ date: -1 })
      : await DailyReport.find({ date: selectedDate, unitId: selectedUnitId }).populate('centerId');
    
    // Fetch resident population, first half stats, and plan target of selected unit
    const selectedUnitObj = await User.findById(selectedUnitId);
    const residentPopulation = selectedUnitObj ? selectedUnitObj.residentPopulation : 0;
    const firstHalfChecked = selectedUnitObj ? selectedUnitObj.firstHalfChecked : 0;
    const planTarget = selectedUnitObj ? (selectedUnitObj.planTarget || 0) : 0;

    // Fetch entered history of all days for this unit
    const historyList = await DailyReport.aggregate([
      { $match: { unitId: new mongoose.Types.ObjectId(selectedUnitId) } },
      {
        $group: {
          _id: '$date',
          under6: { $sum: '$under6' },
          from6To18: { $sum: '$from6To18' },
          over18: { $sum: '$over18' },
          adminUnder6: { $sum: '$adminUnder6' },
          adminFrom6To18: { $sum: '$adminFrom6To18' },
          adminOver18: { $sum: '$adminOver18' }
        }
      }
    ]);

    // Map aggregated results for O(1) lookup
    const historyMap = {};
    historyList.forEach(h => {
      const d = new Date(h._id);
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      historyMap[dateStr] = h;
    });

    const isUserAdmin = req.session.userRole === 'admin';
    const allDays = [];
    const startDate = new Date(Date.UTC(2026, 6, 1)); // 2026-07-01
    const endDate = new Date(Date.UTC(2026, 8, 30));  // 2026-09-30
    
    let loopDate = new Date(startDate);
    while (loopDate <= endDate) {
      const year = loopDate.getUTCFullYear();
      const month = String(loopDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(loopDate.getUTCDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const dateDisplay = `${day}/${month}/${year}`;

      const matched = historyMap[dateStr] || { 
        under6: 0, from6To18: 0, over18: 0,
        adminUnder6: 0, adminFrom6To18: 0, adminOver18: 0
      };
      
      const u6 = isUserAdmin ? matched.adminUnder6 : matched.under6;
      const f6 = isUserAdmin ? matched.adminFrom6To18 : matched.from6To18;
      const o18 = isUserAdmin ? matched.adminOver18 : matched.over18;

      allDays.push({
        dateStr,
        dateDisplay,
        under6: u6,
        from6To18: f6,
        over18: o18,
        total: u6 + f6 + o18
      });

      loopDate.setUTCDate(loopDate.getUTCDate() + 1);
    }

    // Sort descending (newest first)
    allDays.reverse();

    // Fetch all BYT linkage records for admin input page, sorted by date descending
    let bytLinkages = [];
    let bytLinkageCount = 0;
    if (req.session.userRole === 'admin') {
      bytLinkages = await BytLinkage.find().populate('updatedBy').sort({ date: -1 });
      const currentLinkage = bytLinkages.find(b => new Date(b.date).getTime() === selectedDate.getTime());
      if (currentLinkage) {
        bytLinkageCount = currentLinkage.count;
      }
    }

    res.render('input', {
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.userRole,
        unitName: req.session.unitName
      },
      selectedDateStr: queryDateStr,
      bytLinkageCount,
      bytLinkages,
      selectedUnitId,
      centers,
      allCenters,
      reports,
      units,
      residentPopulation,
      firstHalfChecked,
      planTarget,
      allDays,
      success: req.session.success || req.query.success || null,
      error: req.session.error || req.query.error || null
    });
  } catch (error) {
    console.error('Input GET error:', error);
    res.status(500).send('Lỗi tải trang nhập liệu');
  }
});

// Submit / Edit report data
app.post('/input', requireAuth, async (req, res) => {
  const { 
    reportId,
    date, 
    centerId, 
    under6, 
    from6To18, 
    over18,
    adminWorkplace,
    adminWorkers,
    adminChildren,
    adminPolitical,
    adminOthers
  } = req.body;
  
  let targetUnitId = req.session.userId;
  if (req.session.userRole === 'admin' && req.body.unitId) {
    targetUnitId = req.body.unitId;
  }

  try {
    const selectedDate = parseDateUTC(date);
    const startDate = parseDateUTC('2026-07-01');
    const endDate = parseDateUTC('2026-09-30');

    // Validation date range
    if (selectedDate < startDate || selectedDate > endDate) {
      return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent('Ngày nhập liệu phải nằm trong khoảng từ 01/07 đến 30/09')}`);
    }

    const cId = (centerId && mongoose.isValidObjectId(centerId)) ? new mongoose.Types.ObjectId(centerId) : null;
    const uId = new mongoose.Types.ObjectId(targetUnitId);
    const isAdmin = req.session.userRole === 'admin';

    // Parse and map inputs based on role
    let valUnder6 = 0;
    let valFrom6To18 = 0;
    let valOver18 = 0;
    let workplace = '';
    let workers = 0;
    let children = 0;
    let political = 0;
    let others = 0;

    const isGeneralAdminInput = isAdmin && (!adminWorkplace || adminWorkplace.trim() === '');

    if (isAdmin) {
      if (isGeneralAdminInput) {
        valUnder6 = parseInt(under6) || 0;
        valFrom6To18 = parseInt(from6To18) || 0;
        valOver18 = parseInt(over18) || 0;
      } else {
        workplace = adminWorkplace.trim();
        workers = parseInt(adminWorkers) || 0;
        children = parseInt(adminChildren) || 0;
        political = parseInt(adminPolitical) || 0;
        others = parseInt(adminOthers) || 0;
        
        // Map categories to age groups for homepage view compatibility
        valUnder6 = 0;
        valFrom6To18 = children;
        valOver18 = workers + political + others;
      }
    } else {
      valUnder6 = parseInt(under6) || 0;
      valFrom6To18 = parseInt(from6To18) || 0;
      valOver18 = parseInt(over18) || 0;
    }

    // Check if the center belongs to the unit (only for general inputs)
    let center = null;
    if (!isAdmin || isGeneralAdminInput) {
      center = await HealthCenter.findOne({ _id: cId, unitId: uId });
      if (!center) {
        return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent('Trạm y tế không hợp lệ hoặc không thuộc đơn vị này')}`);
      }
    }

    let existing = null;
    if (reportId && reportId !== '') {
      existing = await DailyReport.findById(reportId);
    } else if (isGeneralAdminInput) {
      existing = await DailyReport.findOne({ date: selectedDate, centerId: cId, $or: [{ adminWorkplace: '' }, { adminWorkplace: { $exists: false } }] });
    } else if (!isAdmin) {
      existing = await DailyReport.findOne({ date: selectedDate, centerId: cId });
    }
    
    if (existing) {
      // Update
      const oldUnder6 = isAdmin ? existing.adminUnder6 : existing.under6;
      const oldFrom6To18 = isAdmin ? existing.adminFrom6To18 : existing.from6To18;
      const oldOver18 = isAdmin ? existing.adminOver18 : existing.over18;

      if (isAdmin) {
        existing.adminUnder6 = valUnder6;
        existing.adminFrom6To18 = valFrom6To18;
        existing.adminOver18 = valOver18;
        existing.adminWorkplace = workplace;
        existing.adminWorkers = workers;
        existing.adminChildren = children;
        existing.adminPolitical = political;
        existing.adminOthers = others;
        if (isGeneralAdminInput) {
          existing.unitId = uId;
          existing.centerId = cId;
        } else {
          existing.unitId = null;
          existing.centerId = null;
        }
      } else {
        existing.under6 = valUnder6;
        existing.from6To18 = valFrom6To18;
        existing.over18 = valOver18;
      }
      existing.updatedBy = req.session.userId;
      await existing.save();

      // Log details
      await AuditLog.create({
        userId: req.session.userId,
        username: req.session.username,
        action: 'UPDATE',
        targetType: 'REPORT',
        details: isAdmin 
          ? (isGeneralAdminInput 
              ? `Cập nhật số liệu khám chung [${center ? center.name : '-'}] ngày ${date}: Dưới 6 tuổi (${oldUnder6}->${valUnder6}), 6-18 tuổi (${oldFrom6To18}->${valFrom6To18}), Trên 18 tuổi (${oldOver18}->${valOver18})`
              : `Cập nhật đơn vị KSK [${workplace}] ngày ${date}: CN/VC/NLĐ (${workers}), Trẻ em (${children}), HT chính trị (${political}), Khác (${others})`)
          : `Cập nhật số liệu [${center ? center.name : '-'}] ngày ${date}: Dưới 6 tuổi (${oldUnder6}->${valUnder6}), 6-18 tuổi (${oldFrom6To18}->${valFrom6To18}), Trên 18 tuổi (${oldOver18}->${valOver18})`
      });

    } else {
      // Create new
      const createData = {
        date: selectedDate,
        updatedBy: req.session.userId
      };
      
      if (isAdmin) {
        if (isGeneralAdminInput) {
          createData.unitId = uId;
          createData.centerId = cId;
          createData.adminUnder6 = valUnder6;
          createData.adminFrom6To18 = valFrom6To18;
          createData.adminOver18 = valOver18;
          createData.adminWorkplace = '';
          createData.adminWorkers = 0;
          createData.adminChildren = 0;
          createData.adminPolitical = 0;
          createData.adminOthers = 0;
        } else {
          createData.unitId = null;
          createData.centerId = null;
          createData.adminUnder6 = valUnder6;
          createData.adminFrom6To18 = valFrom6To18;
          createData.adminOver18 = valOver18;
          createData.adminWorkplace = workplace;
          createData.adminWorkers = workers;
          createData.adminChildren = children;
          createData.adminPolitical = political;
          createData.adminOthers = others;
        }
        
        createData.under6 = 0;
        createData.from6To18 = 0;
        createData.over18 = 0;
      } else {
        createData.unitId = uId;
        createData.centerId = cId;
        createData.under6 = valUnder6;
        createData.from6To18 = valFrom6To18;
        createData.over18 = valOver18;
        
        createData.adminUnder6 = 0;
        createData.adminFrom6To18 = 0;
        createData.adminOver18 = 0;
        createData.adminWorkplace = '';
        createData.adminWorkers = 0;
        createData.adminChildren = 0;
        createData.adminPolitical = 0;
        createData.adminOthers = 0;
      }
      
      await DailyReport.create(createData);

      // Log details
      await AuditLog.create({
        userId: req.session.userId,
        username: req.session.username,
        action: 'CREATE',
        targetType: 'REPORT',
        details: isAdmin
          ? (isGeneralAdminInput
              ? `Nhập mới số liệu khám chung [${center ? center.name : '-'}] ngày ${date}: Dưới 6 tuổi (${valUnder6}), 6-18 tuổi (${valFrom6To18}), Trên 18 tuổi (${valOver18})`
              : `Nhập mới đơn vị KSK [${workplace}] ngày ${date}: CN/VC/NLĐ (${workers}), Trẻ em (${children}), HT chính trị (${political}), Khác (${others})`)
          : `Nhập mới số liệu [${center ? center.name : '-'}] ngày ${date}: Dưới 6 tuổi (${valUnder6}), 6-18 tuổi (${valFrom6To18}), Trên 18 tuổi (${valOver18})`
      });
    }

    return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&success=${encodeURIComponent('Lưu số liệu khám thành công!')}`);
  } catch (error) {
    console.error('Input POST error:', error);
    return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent('Có lỗi xảy ra khi lưu số liệu')}`);
  }
});

// Delete report entry
app.post('/input/delete', requireAuth, async (req, res) => {
  const { reportId, date, unitId } = req.body;
  
  try {
    const report = await DailyReport.findById(reportId).populate('centerId');
    if (!report) {
      return res.redirect(`/input?date=${date}&unitId=${unitId}&error=${encodeURIComponent('Không tìm thấy bản ghi để xóa')}`);
    }

    // Check authority: units can only delete their own reports
    if (req.session.userRole !== 'admin' && (!report.unitId || report.unitId.toString() !== req.session.userId)) {
      return res.redirect(`/input?date=${date}&unitId=${unitId}&error=${encodeURIComponent('Bạn không có quyền xóa số liệu này')}`);
    }

    const formattedDate = formatDateString(report.date);
    const centerName = report.centerId ? report.centerId.name : '-';
    const isAdmin = req.session.userRole === 'admin';

    if (isAdmin) {
      const workplace = report.adminWorkplace || '';
      await DailyReport.deleteOne({ _id: reportId });

      // Log deletion
      await AuditLog.create({
        userId: req.session.userId,
        username: req.session.username,
        action: 'DELETE',
        targetType: 'REPORT',
        details: `Xóa đơn vị KSK [${workplace}] tại [${centerName}] ngày ${formattedDate}`
      });
    } else {
      const oldUnder6 = report.under6;
      const oldFrom6To18 = report.from6To18;
      const oldOver18 = report.over18;

      report.under6 = 0;
      report.from6To18 = 0;
      report.over18 = 0;
      report.updatedBy = req.session.userId;

      const hasCommuneData = report.under6 > 0 || report.from6To18 > 0 || report.over18 > 0;
      const hasAdminData = report.adminUnder6 > 0 || report.adminFrom6To18 > 0 || report.adminOver18 > 0;

      if (!hasCommuneData && !hasAdminData) {
        await DailyReport.deleteOne({ _id: reportId });
      } else {
        await report.save();
      }

      // Log deletion (acting as clear/reset)
      await AuditLog.create({
        userId: req.session.userId,
        username: req.session.username,
        action: 'DELETE',
        targetType: 'REPORT',
        details: `Xóa số liệu [${centerName}] ngày ${formattedDate} (Xã/Phường nhập): Dưới 6 tuổi (${oldUnder6}), 6-18 tuổi (${oldFrom6To18}), Trên 18 tuổi (${oldOver18})`
      });
    }

    return res.redirect(`/input?date=${date}&unitId=${unitId}&success=${encodeURIComponent('Đã xóa bản ghi số liệu thành công!')}`);
  } catch (error) {
    console.error('Input DELETE error:', error);
    return res.redirect(`/input?date=${date}&unitId=${unitId}&error=${encodeURIComponent('Lỗi khi xóa bản ghi')}`);
  }
});

// Add Health Center
app.post('/centers/add', requireAuth, async (req, res) => {
  const { name, date, redirect } = req.body;
  
  let targetUnitId = req.session.userId;
  if (req.session.userRole === 'admin' && req.body.unitId) {
    targetUnitId = req.body.unitId;
  }

  if (!name || name.trim() === '') {
    const errorMsg = 'Tên trạm y tế không được để trống';
    if (redirect) {
      return res.redirect(`${redirect}?error=${encodeURIComponent(errorMsg)}`);
    }
    return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent(errorMsg)}`);
  }

  try {
    // Add health center to selected unit
    const unit = await User.findById(targetUnitId);
    if (!unit || unit.role !== 'unit') {
      const errorMsg = 'Đơn vị không hợp lệ';
      if (redirect) {
        return res.redirect(`${redirect}?error=${encodeURIComponent(errorMsg)}`);
      }
      return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent(errorMsg)}`);
    }

    // Check if name already exists in unit
    const existing = await HealthCenter.findOne({ 
      name: name.trim(), 
      unitId: targetUnitId 
    });

    if (existing) {
      const errorMsg = 'Trạm y tế này đã tồn tại trong đơn vị';
      if (redirect) {
        return res.redirect(`${redirect}?error=${encodeURIComponent(errorMsg)}`);
      }
      return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent(errorMsg)}`);
    }

    const newCenter = await HealthCenter.create({
      name: name.trim(),
      unitId: targetUnitId
    });

    // Log center creation
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'CREATE',
      targetType: 'CENTER',
      details: `Thêm trạm y tế mới [${newCenter.name}] cho đơn vị ${unit.unitName}`
    });

    const successMsg = `Đã thêm trạm y tế: ${newCenter.name}`;
    if (redirect) {
      return res.redirect(`${redirect}?success=${encodeURIComponent(successMsg)}`);
    }
    return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&success=${encodeURIComponent(successMsg)}`);
  } catch (error) {
    console.error('Add center error:', error);
    const errorMsg = 'Có lỗi xảy ra khi thêm trạm y tế';
    if (redirect) {
      return res.redirect(`${redirect}?error=${encodeURIComponent(errorMsg)}`);
    }
    return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent(errorMsg)}`);
  }
});

// Update resident population
app.post('/input/resident-population', requireAuth, async (req, res) => {
  const { residentPopulation, date } = req.body;
  
  let targetUnitId = req.session.userId;
  if (req.session.userRole === 'admin' && req.body.unitId) {
    targetUnitId = req.body.unitId;
  }

  try {
    const valPop = parseInt(residentPopulation) || 0;
    const unit = await User.findById(targetUnitId);
    if (!unit || unit.role !== 'unit') {
      return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent('Đơn vị không hợp lệ')}`);
    }

    const oldPop = unit.residentPopulation;
    unit.residentPopulation = valPop;
    await unit.save();

    // Log update
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'UPDATE',
      targetType: 'USER',
      details: `Cập nhật nhân khẩu thường trú cho đơn vị ${unit.unitName}: ${oldPop.toLocaleString('vi-VN')} -> ${valPop.toLocaleString('vi-VN')}`
    });

    return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&success=${encodeURIComponent('Cập nhật nhân khẩu thường trú thành công!')}`);
  } catch (error) {
    console.error('Update population error:', error);
    return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent('Lỗi hệ thống khi cập nhật nhân khẩu')}`);
  }
});

// Update first half checked population
app.post('/input/first-half-checked', requireAuth, async (req, res) => {
  const { firstHalfChecked, date } = req.body;
  
  let targetUnitId = req.session.userId;
  if (req.session.userRole === 'admin' && req.body.unitId) {
    targetUnitId = req.body.unitId;
  }

  try {
    const valChecked = parseInt(firstHalfChecked) || 0;
    const unit = await User.findById(targetUnitId);
    if (!unit || unit.role !== 'unit') {
      return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent('Đơn vị không hợp lệ')}`);
    }

    const oldChecked = unit.firstHalfChecked;
    unit.firstHalfChecked = valChecked;
    await unit.save();

    // Log update
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'UPDATE',
      targetType: 'USER',
      details: `Cập nhật số khám 6 tháng đầu năm cho đơn vị ${unit.unitName}: ${oldChecked.toLocaleString('vi-VN')} -> ${valChecked.toLocaleString('vi-VN')}`
    });

    return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&success=${encodeURIComponent('Cập nhật số người đã khám 6 tháng đầu năm thành công!')}`);
  } catch (error) {
    console.error('Update first half checked error:', error);
    return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent('Lỗi hệ thống khi cập nhật số khám 6 tháng')}`);
  }
});

// Update plan target (90 days)
app.post('/input/plan-target', requireAuth, async (req, res) => {
  const { planTarget, date } = req.body;
  
  let targetUnitId = req.session.userId;
  if (req.session.userRole === 'admin' && req.body.unitId) {
    targetUnitId = req.body.unitId;
  }

  try {
    const valTarget = parseInt(planTarget) || 0;
    const unit = await User.findById(targetUnitId);
    if (!unit || unit.role !== 'unit') {
      return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent('Đơn vị không hợp lệ')}`);
    }

    const oldTarget = unit.planTarget || 0;
    unit.planTarget = valTarget;
    await unit.save();

    // Log update
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'UPDATE',
      targetType: 'USER',
      details: `Cập nhật chỉ tiêu 90 ngày cho đơn vị ${unit.unitName}: ${oldTarget.toLocaleString('vi-VN')} -> ${valTarget.toLocaleString('vi-VN')}`
    });

    return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&success=${encodeURIComponent('Cập nhật chỉ tiêu 90 ngày thành công!')}`);
  } catch (error) {
    console.error('Update plan target error:', error);
    return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent('Lỗi hệ thống khi cập nhật chỉ tiêu')}`);
  }
});

// -------------------------------------------------------------
// ROUTES: ADMIN HEALTH CENTERS MANAGEMENT (DANH MỤC TRẠM Y TẾ)
// -------------------------------------------------------------

app.get('/admin/centers', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const units = await User.find({ role: 'unit' }).sort({ unitName: 1 });
    const centers = await HealthCenter.find().populate('unitId').sort({ name: 1 });
    
    // Sort in memory by unit name alphabetically
    centers.sort((a, b) => {
      const nameA = a.unitId ? a.unitId.unitName : '';
      const nameB = b.unitId ? b.unitId.unitName : '';
      return nameA.localeCompare(nameB, 'vi');
    });

    res.render('admin/centers', {
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.userRole,
        unitName: req.session.unitName
      },
      centers,
      units,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('GET admin centers error:', error);
    res.status(500).send('Lỗi hệ thống khi tải danh mục trạm y tế');
  }
});

app.post('/admin/centers/edit', requireAuth, requireRole('admin'), async (req, res) => {
  const { id, name, unitId } = req.body;

  if (!id || !name || name.trim() === '' || !unitId) {
    return res.redirect('/admin/centers?error=' + encodeURIComponent('Thông tin chỉnh sửa không hợp lệ'));
  }

  try {
    const center = await HealthCenter.findById(id);
    if (!center) {
      return res.redirect('/admin/centers?error=' + encodeURIComponent('Không tìm thấy trạm y tế'));
    }

    const oldName = center.name;

    // Check if new name already exists in target unit (excluding this center itself)
    const existing = await HealthCenter.findOne({
      _id: { $ne: id },
      name: name.trim(),
      unitId: unitId
    });

    if (existing) {
      return res.redirect('/admin/centers?error=' + encodeURIComponent('Tên trạm y tế đã tồn tại trong đơn vị này'));
    }

    const newUnit = await User.findById(unitId);
    if (!newUnit || newUnit.role !== 'unit') {
      return res.redirect('/admin/centers?error=' + encodeURIComponent('Đơn vị không hợp lệ'));
    }

    center.name = name.trim();
    center.unitId = unitId;
    await center.save();

    // Log the change
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'UPDATE',
      targetType: 'CENTER',
      details: `Chỉnh sửa trạm y tế [${oldName}] -> [${center.name}], chuyển sang đơn vị ${newUnit.unitName}`
    });

    return res.redirect('/admin/centers?success=' + encodeURIComponent(`Đã cập nhật thông tin trạm y tế: ${center.name}`));
  } catch (error) {
    console.error('Edit health center error:', error);
    return res.redirect('/admin/centers?error=' + encodeURIComponent('Có lỗi xảy ra khi chỉnh sửa trạm y tế'));
  }
});

app.post('/admin/centers/delete/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const centerId = req.params.id;
    const center = await HealthCenter.findById(centerId);
    if (!center) {
      return res.redirect('/admin/centers?error=' + encodeURIComponent('Không tìm thấy trạm y tế'));
    }

    // Check if this center has any daily reports in the database
    const reportsCount = await DailyReport.countDocuments({ centerId });
    if (reportsCount > 0) {
      return res.redirect('/admin/centers?error=' + encodeURIComponent('Trạm y tế này đã có số liệu báo cáo, không thể xóa (chỉ có thể khóa)'));
    }

    await HealthCenter.findByIdAndDelete(centerId);

    // Log target deletion
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'DELETE',
      targetType: 'CENTER',
      details: `Xóa trạm y tế [${center.name}]`
    });

    return res.redirect('/admin/centers?success=' + encodeURIComponent(`Đã xóa trạm y tế: ${center.name}`));
  } catch (error) {
    console.error('Delete center error:', error);
    return res.redirect('/admin/centers?error=' + encodeURIComponent('Lỗi khi xóa trạm y tế'));
  }
});

// -------------------------------------------------------------
// ROUTES: ADMIN CONFIGURATIONS (TARGETS & CONTACT INFO)
// -------------------------------------------------------------

app.get('/admin/targets', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const units = await User.find({ role: 'unit' }).sort({ unitName: 1 });
    res.render('admin/targets', {
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.userRole,
        unitName: req.session.unitName
      },
      units,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('GET targets error:', error);
    res.status(500).send('Lỗi hệ thống');
  }
});

app.post('/admin/targets', requireAuth, requireRole('admin'), async (req, res) => {
  const { unitId, planTarget, residentPopulation, firstHalfChecked, contactName, contactPhone, contactEmail } = req.body;

  try {
    const unit = await User.findById(unitId);
    if (!unit || unit.role !== 'unit') {
      return res.redirect('/admin/targets?error=' + encodeURIComponent('Không tìm thấy đơn vị hợp lệ'));
    }

    const oldTarget = unit.planTarget;
    const newTarget = parseInt(planTarget) || 0;
    const oldPop = unit.residentPopulation;
    const newPop = parseInt(residentPopulation) || 0;
    const oldFirstHalf = unit.firstHalfChecked;
    const newFirstHalf = parseInt(firstHalfChecked) || 0;

    unit.planTarget = newTarget;
    unit.residentPopulation = newPop;
    unit.firstHalfChecked = newFirstHalf;
    unit.contactName = contactName ? contactName.trim() : '';
    unit.contactPhone = contactPhone ? contactPhone.trim() : '';
    unit.contactEmail = contactEmail ? contactEmail.trim() : '';
    
    await unit.save();

    // Log target change
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'UPDATE',
      targetType: 'TARGET',
      details: `Thay đổi cấu hình đơn vị ${unit.unitName}: Chỉ tiêu kế hoạch (${oldTarget}->${newTarget}), Nhân khẩu (${oldPop}->${newPop}), Khám 6T đầu năm (${oldFirstHalf}->${newFirstHalf}), Họ tên liên hệ (${unit.contactName}), SĐT (${unit.contactPhone}), Email (${unit.contactEmail})`
    });

    return res.redirect('/admin/targets?success=' + encodeURIComponent(`Đã cập nhật chỉ số cho đơn vị ${unit.unitName}`));
  } catch (error) {
    console.error('POST targets error:', error);
    return res.redirect('/admin/targets?error=' + encodeURIComponent('Lỗi cập nhật cấu hình'));
  }
});

// Update BYT Linkage count (Admin only)
app.post('/admin/byt-linkage', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { date, count } = req.body;
    if (!date) {
      return res.redirect(`/input?error=${encodeURIComponent('Ngày không hợp lệ')}`);
    }

    const selectedDate = parseDateUTC(date);
    const linkageCount = parseInt(count) || 0;

    const existing = await BytLinkage.findOne({ date: selectedDate });
    if (existing) {
      existing.count = linkageCount;
      existing.updatedBy = req.session.userId;
      await existing.save();
    } else {
      await BytLinkage.create({
        date: selectedDate,
        count: linkageCount,
        updatedBy: req.session.userId
      });
    }

    // Log this action
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'UPDATE',
      targetType: 'REPORT',
      details: `Cập nhật số lượt liên thông cổng BYT cho ngày ${date}: ${linkageCount}`
    });

    return res.redirect(`/input?date=${date}&success=${encodeURIComponent('Đã cập nhật số lượt liên thông cổng BYT')}`);
  } catch (error) {
    console.error('POST byt-linkage error:', error);
    return res.redirect(`/input?error=${encodeURIComponent('Lỗi lưu số lượt liên thông cổng BYT')}`);
  }
});

app.post('/admin/byt-linkage/delete', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { linkageId, date } = req.body;
    const item = await BytLinkage.findById(linkageId);
    if (item) {
      const formattedDate = formatDateString(item.date);
      await BytLinkage.deleteOne({ _id: linkageId });

      await AuditLog.create({
        userId: req.session.userId,
        username: req.session.username,
        action: 'DELETE',
        targetType: 'REPORT',
        details: `Xóa số lượt liên thông cổng BYT của ngày ${formattedDate}`
      });
    }
    return res.redirect(`/input?date=${date}&success=${encodeURIComponent('Đã xóa lượt liên thông cổng BYT')}`);
  } catch (error) {
    console.error('DELETE byt-linkage error:', error);
    return res.redirect(`/input?error=${encodeURIComponent('Lỗi xóa số lượt liên thông cổng BYT')}`);
  }
});


// -------------------------------------------------------------
// ROUTES: AUDIT LOG HISTORY
// -------------------------------------------------------------

app.get('/admin/logs', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 50; // logs per page
    const skip = (page - 1) * limit;

    let filter = {};
    if (req.query.username) {
      filter.username = { $regex: req.query.username, $options: 'i' };
    }
    if (req.query.action) {
      filter.action = req.query.action;
    }

    const totalLogs = await AuditLog.countDocuments(filter);
    const logs = await AuditLog.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    res.render('admin/logs', {
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.userRole,
        unitName: req.session.unitName
      },
      logs,
      currentPage: page,
      totalPages: Math.ceil(totalLogs / limit),
      usernameQuery: req.query.username || '',
      actionQuery: req.query.action || ''
    });
  } catch (error) {
    console.error('GET logs error:', error);
    res.status(500).send('Lỗi tải danh sách logs');
  }
});

// -------------------------------------------------------------
// ROUTES: PROFILE MANAGEMENT
// -------------------------------------------------------------

app.get('/profile', requireAuth, async (req, res) => {
  try {
    const profile = await User.findById(req.session.userId);
    res.render('profile', {
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.userRole,
        unitName: req.session.unitName
      },
      profile,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Profile GET error:', error);
    res.status(500).send('Lỗi tải trang hồ sơ');
  }
});

app.post('/profile', requireAuth, async (req, res) => {
  const { contactName, contactPhone, contactEmail, password, confirmPassword } = req.body;

  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.redirect('/profile?error=' + encodeURIComponent('Không tìm thấy tài khoản'));
    }

    // Update contact info
    user.contactName = contactName ? contactName.trim() : '';
    user.contactPhone = contactPhone ? contactPhone.trim() : '';
    user.contactEmail = contactEmail ? contactEmail.trim() : '';

    let detailsMsg = `Cập nhật thông tin liên hệ: Tên (${user.contactName}), SĐT (${user.contactPhone}), Email (${user.contactEmail})`;

    // Update password if typed
    if (password && password.trim() !== '') {
      if (password !== confirmPassword) {
        return res.redirect('/profile?error=' + encodeURIComponent('Mật khẩu mới và mật khẩu xác nhận không khớp'));
      }
      user.password = await bcrypt.hash(password, 10);
      detailsMsg += ' và Đổi mật khẩu thành công';
    }

    await user.save();

    // Log profile update
    await AuditLog.create({
      userId: user._id,
      username: user.username,
      action: 'UPDATE',
      targetType: 'USER',
      details: detailsMsg
    });

    return res.redirect('/profile?success=' + encodeURIComponent('Đã cập nhật thông tin tài khoản thành công!'));
  } catch (error) {
    console.error('Profile POST error:', error);
    return res.redirect('/profile?error=' + encodeURIComponent('Lỗi hệ thống khi cập nhật thông tin'));
  }
});

// Connect to Database and then start Express Server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Sở Y Tế health check app running on http://localhost:${PORT}`);
  });
});
