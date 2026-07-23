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
const SystemConfig = require('./models/SystemConfig');

// Middleware
const { requireAuth, requireRole } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Helper to get system config value
async function getConfigValue(key, defaultValue) {
  try {
    const config = await SystemConfig.findOne({ key });
    if (config && config.value !== undefined) {
      return config.value;
    }
    return defaultValue;
  } catch (error) {
    console.error(`Error getting config for ${key}:`, error);
    return defaultValue;
  }
}

// Helper to sort reportsTable according to unitSortType configuration ('stt', 'cumulative_desc', 'cumulative_asc', 'completion_rate_desc', 'completion_rate_asc', 'alphabet')
function sortReportsTable(reportsTable, unitSortType) {
  const getUnitType = (name) => {
    if (!name) return 3;
    if (name.startsWith('Phường')) return 1;
    if (name.startsWith('Xã')) return 2;
    return 3;
  };

  const getCumulative = (item) => {
    if (typeof item.cumulative === 'number') return item.cumulative;
    if (item.cumulative && typeof item.cumulative.total === 'number') return item.cumulative.total;
    if (typeof item.yearCumulative === 'number') return item.yearCumulative;
    return 0;
  };

  reportsTable.sort((a, b) => {
    if (unitSortType === 'cumulative_desc') {
      const cumA = getCumulative(a);
      const cumB = getCumulative(b);
      if (cumB !== cumA) return cumB - cumA;
      return (a.unitName || '').localeCompare(b.unitName || '', 'vi', { sensitivity: 'base' });
    } else if (unitSortType === 'cumulative_asc') {
      const cumA = getCumulative(a);
      const cumB = getCumulative(b);
      if (cumA !== cumB) return cumA - cumB;
      return (a.unitName || '').localeCompare(b.unitName || '', 'vi', { sensitivity: 'base' });
    } else if (unitSortType === 'completion_rate_desc' || unitSortType === 'completion_rate') {
      const rateA = a.completionRate || 0;
      const rateB = b.completionRate || 0;
      if (rateB !== rateA) return rateB - rateA;
      return (a.unitName || '').localeCompare(b.unitName || '', 'vi', { sensitivity: 'base' });
    } else if (unitSortType === 'completion_rate_asc') {
      const rateA = a.completionRate || 0;
      const rateB = b.completionRate || 0;
      if (rateA !== rateB) return rateA - rateB;
      return (a.unitName || '').localeCompare(b.unitName || '', 'vi', { sensitivity: 'base' });
    } else if (unitSortType === 'alphabet') {
      return (a.unitName || '').localeCompare(b.unitName || '', 'vi', { sensitivity: 'base' });
    } else {
      // Default: 'stt' (Số thứ tự đơn vị)
      const orderA = a.order || 0;
      const orderB = b.order || 0;
      if (orderA !== orderB) return orderA - orderB;

      const typeA = getUnitType(a.unitName || '');
      const typeB = getUnitType(b.unitName || '');
      if (typeA !== typeB) return typeA - typeB;

      const nameA = (a.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
      const nameB = (b.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
      return nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' });
    }
  });
}



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

// Get current date string in Vietnam timezone (YYYY-MM-DD)
function getTodayStringVN() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

// -------------------------------------------------------------
// SVG COMPILATION HELPER
// -------------------------------------------------------------
async function compileReportSvg(dateStr) {
  const selectedDate = parseDateUTC(dateStr);
  const dateString = `${String(selectedDate.getUTCDate()).padStart(2, '0')}/${String(selectedDate.getUTCMonth() + 1).padStart(2, '0')}/${selectedDate.getUTCFullYear()}`;

  const startDate = parseDateUTC('2026-07-01');
  const cumulativeMatchLimit = selectedDate;

  // Fetch all unit users sorted by order, type, and name (A-Z)
  const units = await User.find({ role: 'unit' });
  units.sort((a, b) => {
    const orderA = a.order || 0;
    const orderB = b.order || 0;
    if (orderA !== orderB) return orderA - orderB;

    const getUnitType = (name) => {
      if (name.startsWith('Phường')) return 1;
      if (name.startsWith('Xã')) return 2;
      return 3;
    };
    const typeA = getUnitType(a.unitName || '');
    const typeB = getUnitType(b.unitName || '');
    if (typeA !== typeB) return typeA - typeB;

    const nameA = (a.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
    const nameB = (b.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
    return nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' });
  });

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
  const grandFirstHalfTotal = await getConfigValue('grand_first_half_checked', 833233);
  let grandTargetTotal = 0;
  const grandResidentPopulation = await getConfigValue('grand_resident_population', 3194187);
  const campaignTarget = await getConfigValue('campaign_target', 2128099);
  const campaignOffset = await getConfigValue('campaign_offset', 40000);
  let grandFirstHalfCheckedSum = 0;

  const reportsTable = [];
  units.forEach(unit => {
    const uId = unit._id.toString();
    const dailyVal = dailyMap[uId] ? dailyMap[uId].total : 0;
    const cumulativeVal = cumulativeMap[uId] ? cumulativeMap[uId].total : 0;
    const targetVal = unit.planTarget || 0;
    const completionRateVal = targetVal > 0 ? (cumulativeVal / targetVal) * 100 : 0;

    reportsTable.push({
      unitName: unit.unitName,
      order: unit.order || 0,
      daily: dailyVal,
      cumulative: cumulativeVal,
      residentPopulation: unit.residentPopulation || 0,
      firstHalfChecked: unit.firstHalfChecked || 0,
      planTarget: targetVal,
      completionRate: completionRateVal
    });

    grandDailyTotal += dailyVal;
    grandCumulativeTotal += cumulativeVal;
    grandTargetTotal += targetVal;
    grandFirstHalfCheckedSum += (unit.firstHalfChecked || 0);
  });

  // Sort reportsTable based on system config (stt, completion_rate, alphabet)
  const unitSortType = await getConfigValue('unit_sort_type', 'stt');
  sortReportsTable(reportsTable, unitSortType, false);


  // Fetch BYT Linkage count for this date and cumulative
  const bytTodayObj = await BytLinkage.findOne({ date: selectedDate }) || { count: 0 };
  const grandBytToday = bytTodayObj.count || 0;

  const bytLuyKeAgg = await BytLinkage.aggregate([
    { $match: { date: { $lte: selectedDate } } },
    { $group: { _id: null, total: { $sum: '$count' } } }
  ]);
  const grandBytLuyKe = bytLuyKeAgg.length > 0 ? bytLuyKeAgg[0].total : 0;

  // Fetch BytLinkage for global metrics on this date
  // Get latest non-zero cnldCount up to selectedDate, falling back to overall latest if none
  let cnldLuyKeObj = await BytLinkage.findOne({ date: { $lte: selectedDate }, cnldCount: { $gt: 0 } }).sort({ date: -1 });
  if (!cnldLuyKeObj) {
    cnldLuyKeObj = await BytLinkage.findOne({ cnldCount: { $gt: 0 } }).sort({ date: -1 });
  }
  const cnldLuyKe = cnldLuyKeObj ? cnldLuyKeObj.cnldCount : 0;

  // Get latest non-zero tehsCount up to selectedDate, falling back to overall latest if none
  let tehsLuyKeObj = await BytLinkage.findOne({ date: { $lte: selectedDate }, tehsCount: { $gt: 0 } }).sort({ date: -1 });
  if (!tehsLuyKeObj) {
    tehsLuyKeObj = await BytLinkage.findOne({ tehsCount: { $gt: 0 } }).sort({ date: -1 });
  }
  const tehsLuyKe = tehsLuyKeObj ? tehsLuyKeObj.tehsCount : 0;

  // Aggregate cumulative CBCCVC (political reports)
  const politicalAgg = await DailyReport.aggregate([
    {
      $match: {
        date: { $gte: startDate, $lte: selectedDate },
        adminIsPolitical: true
      }
    },
    {
      $group: {
        _id: null,
        totalPolitical: { $sum: '$adminPolitical' }
      }
    }
  ]);
  const cbccvcLuyKe = politicalAgg.length > 0 ? politicalAgg[0].totalPolitical : 0;

  const includeCnldCbccvc = await getConfigValue('include_cnld_cbccvc_in_total', true);
  const includeTehs = await getConfigValue('include_tehs_in_total', true);

  // Fetch cumulative workplace reports that are marked to be included in total
  const workplaceIncludedAgg = await DailyReport.aggregate([
    {
      $match: {
        date: { $gte: startDate, $lte: selectedDate },
        type: 'workplace',
        adminIncludeInTotal: true
      }
    },
    {
      $group: {
        _id: null,
        totalWorkplace: {
          $sum: {
            $add: [
              { $ifNull: ['$adminWorkers', 0] },
              { $ifNull: ['$adminChildren', 0] },
              { $ifNull: ['$adminPolitical', 0] },
              { $ifNull: ['$adminOthers', 0] }
            ]
          }
        }
      }
    }
  ]);
  const workplaceIncludedLuyKe = workplaceIncludedAgg.length > 0 ? workplaceIncludedAgg[0].totalWorkplace : 0;

  const grandOverallTotal = grandCumulativeTotal + grandFirstHalfTotal + grandFirstHalfCheckedSum - campaignOffset + (includeTehs ? tehsLuyKe : 0) + (includeCnldCbccvc ? (cnldLuyKe + cbccvcLuyKe) : 0) + workplaceIncludedLuyKe;
  const progressRateOverall = grandResidentPopulation > 0 ? (grandOverallTotal / grandResidentPopulation) * 100 : 0;
  const progressRateCampaign = campaignTarget > 0 ? (grandOverallTotal / campaignTarget) * 100 : 0;

  // Generate the SVG dynamic text nodes for the 96 communes
  let dynamicTexts = '';
  for (let i = 0; i < 96; i++) {
    const unit = reportsTable[i];
    if (!unit) continue;

    const col = Math.floor(i / 32); // Columns: 0, 1, 2
    const row = i % 32;

    let xName = 120;
    let xDaily = 455;
    let xCumulative = 586;
    let xRate = 716;

    if (col === 1) {
      xName = 907;
      xDaily = 1242;
      xCumulative = 1373;
      xRate = 1503;
    } else if (col === 2) {
      xName = 1694;
      xDaily = 2029;
      xCumulative = 2160;
      xRate = 2290;
    }

    const yName = 1171.75 + row * 51;
    const yVal = 1172.75 + row * 51;

    const escapeXml = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const name = escapeXml(unit.unitName);
    const daily = unit.daily.toLocaleString('vi-VN');
    const cumulative = unit.cumulative.toLocaleString('vi-VN');

    const rateVal = unit.planTarget > 0 ? (unit.cumulative / unit.planTarget) * 100 : 0;
    const rate = rateVal.toFixed(1) + '%';

    dynamicTexts += `<text fill="black" style="white-space: pre" xml:space="preserve" font-family="Momo Trust Display Web" font-size="30" letter-spacing="0em"><tspan x="${xName}" y="${yName}">${name}</tspan></text>\n`;
    dynamicTexts += `<text fill="black" style="white-space: pre" xml:space="preserve" font-family="Momo Trust Display Web" font-size="30" letter-spacing="0em"><tspan x="${xDaily}" y="${yVal}">${daily}</tspan></text>\n`;
    dynamicTexts += `<text fill="black" style="white-space: pre" xml:space="preserve" font-family="Momo Trust Display Web" font-size="30" letter-spacing="0em"><tspan x="${xCumulative}" y="${yVal}">${cumulative}</tspan></text>\n`;
    dynamicTexts += `<text fill="black" style="white-space: pre" xml:space="preserve" font-family="Momo Trust Display Web" font-size="30" letter-spacing="0em"><tspan x="${xRate}" y="${yVal}">${rate}</tspan></text>\n`;
  }

  // Read templates and replace variables
  let template = fs.readFileSync(path.join(__dirname, '../views/report_template.svg'), 'utf8');

  // Replace dynamic text elements
  template = template.replace('<!-- DYNAMIC_TEXT_ELEMENTS -->', dynamicTexts);

  // Replace "Tổng khám" text with placeholders so they get dynamic overall total values
  template = template.replace(/T&#x1ed5;ng kh&#xe1;m\/\{5\}/g, '{4}/{5}');
  template = template.replace(/T&#x1ed5;ng kh&#xe1;m\/2\.128\.099/g, '{4}/' + campaignTarget.toLocaleString('vi-VN'));

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
  const cnldStr = cnldLuyKe.toLocaleString('vi-VN');
  const cnldLength = cnldStr.length;
  const cnldXOffset = cnldLength > 1 ? -15 * (cnldLength - 1) : 0;
  const cnldX = (277.044 + cnldXOffset).toFixed(3);
  template = template.replace(/x="277\.044"([^>]*>)\{CNLD_KSK\}/g, `x="${cnldX}"$1${cnldStr}`);

  const tehsStr = tehsLuyKe.toLocaleString('vi-VN');
  const tehsLength = tehsStr.length;
  const tehsXOffset = tehsLength > 1 ? -13 * (tehsLength - 1) : 0;
  const tehsX = (1209.04 + tehsXOffset).toFixed(3);
  template = template.replace(/x="1209\.04"([^>]*>)\{TEHS_KSK\}/g, `x="${tehsX}"$1${tehsStr}`);
  const cbccvcStr = cbccvcLuyKe.toLocaleString('vi-VN');
  const cbccvcLength = cbccvcStr.length;
  const cbccvcXOffset = cbccvcLength > 1 ? -13 * (cbccvcLength - 1) : 0;
  const cbccvcX = (751.544 + cbccvcXOffset).toFixed(3);
  template = template.replace(/x="751\.544"([^>]*>)\{CBCCVC_KSK\}/g, `x="${cbccvcX}"$1${cbccvcStr}`);

  // Replace report date globally
  template = template.replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, dateString);

  return template;
}

// -------------------------------------------------------------
// ROUTES: A4 FIGMA REPORT GENERATOR
// -------------------------------------------------------------
app.get('/report', async (req, res) => {
  try {
    let date = req.query.date;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
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
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
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
    const todayStrVN = getTodayStringVN();
    const [year, month, day] = todayStrVN.split('-').map(Number);
    if (year === 2026 && month >= 7 && month <= 9) {
      defaultDate = todayStrVN;
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

    // Fetch all units sorted by order, type, and name (A-Z)
    const units = await User.find({ role: 'unit' });
    units.sort((a, b) => {
      const orderA = a.order || 0;
      const orderB = b.order || 0;
      if (orderA !== orderB) return orderA - orderB;

      const getUnitType = (name) => {
        if (name.startsWith('Phường')) return 1;
        if (name.startsWith('Xã')) return 2;
        return 3;
      };
      const typeA = getUnitType(a.unitName || '');
      const typeB = getUnitType(b.unitName || '');
      if (typeA !== typeB) return typeA - typeB;

      const nameA = (a.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
      const nameB = (b.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
      return nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' });
    });

    // Build the reporting table
    const reportsTable = [];
    let grandDaily = { under6: 0, from6To18: 0, over18: 0, total: 0 };
    let grandCumulative = { under6: 0, from6To18: 0, over18: 0, total: 0 };

    let grandAdminDaily = { under6: 0, from6To18: 0, over18: 0, total: 0 };
    let grandAdminCumulative = { under6: 0, from6To18: 0, over18: 0, total: 0 };

    let grandTarget = 0;
    const grandResidentPopulation = await getConfigValue('grand_resident_population', 3194187);
    const grandFirstHalfChecked = await getConfigValue('grand_first_half_checked', 833233);
    const campaignOffset = await getConfigValue('campaign_offset', 40000);
    let grandLocalManagedPopulation = 0;
    let grandFirstHalfCheckedSum = 0;

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
      const yearCumulative = cumulative.total;
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

      const adminYearCumulative = adminCumulative.total;
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
        order: unit.order || 0,
        planTarget: unit.planTarget,
        residentPopulation: unit.residentPopulation,
        localManagedPopulation: unit.localManagedPopulation || 0,
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
      grandLocalManagedPopulation += (unit.localManagedPopulation || 0);
      grandFirstHalfCheckedSum += (unit.firstHalfChecked || 0);

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

    // Fetch BytLinkage cumulative for the selected date
    let cnldLuyKeObj = await BytLinkage.findOne({ date: { $lte: dailyMatchDate }, cnldCount: { $gt: 0 } }).sort({ date: -1 });
    if (!cnldLuyKeObj) {
      cnldLuyKeObj = await BytLinkage.findOne({ cnldCount: { $gt: 0 } }).sort({ date: -1 });
    }
    const cnldLuyKe = cnldLuyKeObj ? cnldLuyKeObj.cnldCount : 0;

    let tehsLuyKeObj = await BytLinkage.findOne({ date: { $lte: dailyMatchDate }, tehsCount: { $gt: 0 } }).sort({ date: -1 });
    if (!tehsLuyKeObj) {
      tehsLuyKeObj = await BytLinkage.findOne({ tehsCount: { $gt: 0 } }).sort({ date: -1 });
    }
    const tehsLuyKe = tehsLuyKeObj ? tehsLuyKeObj.tehsCount : 0;

    // Fetch cumulative CBCCVC (political reports)
    const politicalAgg = await DailyReport.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lte: dailyMatchDate },
          adminIsPolitical: true
        }
      },
      {
        $group: {
          _id: null,
          totalPolitical: { $sum: '$adminPolitical' }
        }
      }
    ]);
    const cbccvcLuyKe = politicalAgg.length > 0 ? politicalAgg[0].totalPolitical : 0;

    const includeCnldCbccvc = await getConfigValue('include_cnld_cbccvc_in_total', true);
    const includeTehs = await getConfigValue('include_tehs_in_total', true);

    // Fetch cumulative workplace reports that are marked to be included in total
    const workplaceIncludedAgg = await DailyReport.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lte: dailyMatchDate },
          type: 'workplace',
          adminIncludeInTotal: true
        }
      },
      {
        $group: {
          _id: null,
          totalWorkplace: {
            $sum: {
              $add: [
                { $ifNull: ['$adminWorkers', 0] },
                { $ifNull: ['$adminChildren', 0] },
                { $ifNull: ['$adminPolitical', 0] },
                { $ifNull: ['$adminOthers', 0] }
              ]
            }
          }
        }
      }
    ]);
    const workplaceIncludedLuyKe = workplaceIncludedAgg.length > 0 ? workplaceIncludedAgg[0].totalWorkplace : 0;

    const isUserAdmin = req.session.userRole === 'admin';
    const displayDaily = grandDaily;
    const displayCumulative = grandCumulative;
    const displayYearCumulative = grandFirstHalfChecked + displayCumulative.total + grandFirstHalfCheckedSum - campaignOffset + (includeTehs ? tehsLuyKe : 0) + (includeCnldCbccvc ? (cnldLuyKe + cbccvcLuyKe) : 0) + workplaceIncludedLuyKe;
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

      const myYearCumulative = myCumulative.total;
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
        const cDailyReport = centerDailyReports.find(r => r.centerId && r.centerId.toString() === cId);
        const cDaily = cDailyReport ? {
          under6: cDailyReport.under6,
          from6To18: cDailyReport.from6To18,
          over18: cDailyReport.over18,
          total: cDailyReport.under6 + cDailyReport.from6To18 + cDailyReport.over18
        } : { under6: 0, from6To18: 0, over18: 0, total: 0 };

        // cumulative for this center
        let cCum = { under6: 0, from6To18: 0, over18: 0, total: 0 };
        centerCumulativeReports.forEach(r => {
          if (r.centerId && r.centerId.toString() === cId) {
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

    // Top 5 units with highest completion rate for topUnits chart
    const topUnits = [...reportsTable]
      .sort((a, b) => (b.completionRate || 0) - (a.completionRate || 0))
      .slice(0, 5)
      .map(u => ({
        ...u,
        completionRate: u.completionRate
      }));

    // Sort reportsTable for detailed 96 communes table & SVG report based on system config (stt, completion_rate, alphabet)
    const unitSortType = await getConfigValue('unit_sort_type', 'stt');
    sortReportsTable(reportsTable, unitSortType);

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
                {
                  $cond: [
                    { $eq: ['$adminIsPolitical', true] },
                    '$adminPolitical',
                    { $add: ['$adminWorkers', '$adminChildren', '$adminPolitical', '$adminOthers'] }
                  ]
                },
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

    // Fetch political system reports (all, not filtered by selected date)
    const dashboardPoliticalReports = await DailyReport.find({
      adminIsPolitical: true
    }).sort({ date: 1, createdAt: 1 });

    // Sort political system reports by completion rate descending (from high to low)
    dashboardPoliticalReports.sort((a, b) => {
      const workersA = a.adminWorkers || 0;
      const politicalA = a.adminPolitical || 0;
      const rateA = workersA > 0 ? (politicalA / workersA) * 100 : 0;

      const workersB = b.adminWorkers || 0;
      const politicalB = b.adminPolitical || 0;
      const rateB = workersB > 0 ? (politicalB / workersB) * 100 : 0;

      if (rateB !== rateA) {
        return rateB - rateA;
      }
      return (a.adminWorkplace || '').localeCompare(b.adminWorkplace || '', 'vi', { sensitivity: 'base' });
    });

    // Generate the SVG report for the dashboard
    const svgContent = await compileReportSvg(formatDateString(dailyMatchDate));

    res.render('dashboard', {
      dashboardPoliticalReports,
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
      grandLocalManagedPopulation,
      grandFirstHalfChecked,
      grandFirstHalfCheckedSum,
      grandYearCumulative: displayYearCumulative,
      overallCompletionRate: displayOverallCompletionRate,
      reportsTable,
      grandMonthly,
      unitStats,
      unitCentersData,
      adminCentersData,
      topUnits,
      progressTimelineLabels: JSON.stringify(progressTimelineLabels),
      progressTimelineData: JSON.stringify(progressTimelineData),
      dashboardNoteText: await getConfigValue('dashboard_note_text', '* Ghi chú: Số đã KSK toàn tỉnh = Lũy kế 90 ngày đêm + Số đã KSK 6 tháng đầu năm + CBCC + CNLĐ - 40.000(người cao tuổi đã khám 6 tháng đầu năm)'),
      dashboardNoteVisible: await getConfigValue('dashboard_note_visible', true)
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
    const todayStr = getTodayStringVN();
    const [year, month, day] = todayStr.split('-').map(Number);
    if (year === 2026 && (month) >= 7 && (month) <= 9) {
      defaultDate = todayStr;
    }

    const queryDateStr = req.query.date || defaultDate;
    const selectedDate = parseDateUTC(queryDateStr);

    // Future date check
    if (queryDateStr > todayStr) {
      return res.redirect(`/input?date=${todayStr}&error=${encodeURIComponent('Không được chọn ngày trong tương lai')}`);
    }

    // Past date check for standard units
    if (req.session.userRole !== 'admin') {
      const allowPastDateInput = await getConfigValue('allow_past_date_input', false);
      if (!allowPastDateInput && queryDateStr < todayStr) {
        return res.redirect(`/input?date=${todayStr}&error=${encodeURIComponent('Không được phép chọn số liệu ngày cũ')}`);
      }
    }

    // List of units for Admin dropdown selector (sorted by order, type, name)
    let units = [];
    if (req.session.userRole === 'admin') {
      units = await User.find({ role: 'unit' });
      units.sort((a, b) => {
        const orderA = a.order || 0;
        const orderB = b.order || 0;
        if (orderA !== orderB) return orderA - orderB;

        const getUnitType = (name) => {
          if (name.startsWith('Phường')) return 1;
          if (name.startsWith('Xã')) return 2;
          return 3;
        };
        const typeA = getUnitType(a.unitName || '');
        const typeB = getUnitType(b.unitName || '');
        if (typeA !== typeB) return typeA - typeB;

        const nameA = (a.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
        const nameB = (b.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
        return nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' });
      });
    }

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
    const localManagedPopulation = selectedUnitObj ? (selectedUnitObj.localManagedPopulation || 0) : 0;
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
    let cnldCount = 0;
    let tehsCount = 0;
    if (req.session.userRole === 'admin') {
      bytLinkages = await BytLinkage.find().populate('updatedBy').sort({ date: -1 });
      const currentLinkage = bytLinkages.find(b => new Date(b.date).getTime() === selectedDate.getTime());
      if (currentLinkage) {
        bytLinkageCount = currentLinkage.count;
      }
      
      // Get overall latest non-zero values for global metrics cards
      const latestCnldObj = await BytLinkage.findOne({ cnldCount: { $gt: 0 } }).sort({ date: -1 });
      cnldCount = latestCnldObj ? latestCnldObj.cnldCount : 0;

      const latestTehsObj = await BytLinkage.findOne({ tehsCount: { $gt: 0 } }).sort({ date: -1 });
      tehsCount = latestTehsObj ? latestTehsObj.tehsCount : 0;
    }

    const dashboardNoteText = await getConfigValue('dashboard_note_text', '* Ghi chú: Số đã KSK toàn tỉnh = Lũy kế 90 ngày đêm + Số đã KSK 6 tháng đầu năm + CBCC + CNLĐ - 40.000(người cao tuổi đã khám 6 tháng đầu năm)');
    const dashboardNoteVisible = await getConfigValue('dashboard_note_visible', true);
    const allowPastDateInput = await getConfigValue('allow_past_date_input', false);
    const includeCnldCbccvc = await getConfigValue('include_cnld_cbccvc_in_total', true);
    const includeTehs = await getConfigValue('include_tehs_in_total', true);
    const unitSortType = await getConfigValue('unit_sort_type', 'stt');

    const grandResidentPopulationConfig = await getConfigValue('grand_resident_population', 3194187);
    const grandFirstHalfCheckedConfig = await getConfigValue('grand_first_half_checked', 833233);
    const campaignTargetConfig = await getConfigValue('campaign_target', 2128099);
    const campaignOffsetConfig = await getConfigValue('campaign_offset', 40000);

    res.render('input', {
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.userRole,
        unitName: req.session.unitName
      },
      selectedDateStr: queryDateStr,
      bytLinkageCount,
      cnldCount,
      tehsCount,
      bytLinkages,
      selectedUnitId,
      centers,
      allCenters,
      reports,
      units,
      residentPopulation,
      localManagedPopulation,
      firstHalfChecked,
      planTarget,
      allDays,
      dashboardNoteText,
      dashboardNoteVisible,
      allowPastDateInput,
      includeCnldCbccvc,
      includeTehs,
      unitSortType,
      grandResidentPopulationConfig,
      grandFirstHalfCheckedConfig,
      campaignTargetConfig,
      campaignOffsetConfig,
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
    adminOthers,
    adminInputMode,
    adminIncludeInTotal
  } = req.body;

  let targetUnitId = req.session.userId;
  if (req.session.userRole === 'admin' && req.body.unitId) {
    targetUnitId = req.body.unitId;
  }

  try {
    const todayStr = getTodayStringVN();

    if (date > todayStr) {
      return res.redirect(`/input?date=${todayStr}&error=${encodeURIComponent('Không được phép nhập số liệu ngày tương lai')}`);
    }

    if (req.session.userRole !== 'admin') {
      const allowPastDateInput = await getConfigValue('allow_past_date_input', false);
      if (!allowPastDateInput && date < todayStr) {
        return res.redirect(`/input?date=${todayStr}&error=${encodeURIComponent('Không được phép nhập số liệu ngày cũ')}`);
      }
    }

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

    const isGeneralAdminInput = isAdmin && (adminInputMode === 'general' || (!adminInputMode && (!adminWorkplace || adminWorkplace.trim() === '')));
    const isPoliticalInput = isAdmin && adminInputMode === 'political';

    if (isAdmin) {
      if (isGeneralAdminInput) {
        valUnder6 = parseInt(under6) || 0;
        valFrom6To18 = parseInt(from6To18) || 0;
        valOver18 = parseInt(over18) || 0;
      } else if (isPoliticalInput) {
        workplace = adminWorkplace.trim();
        workers = parseInt(adminWorkers) || 0; // SỐ CBCC CV NLĐ (target/chỉ tiêu)
        political = parseInt(adminPolitical) || 0; // Số đã KSK
        children = 0;
        others = 0;

        // Mapped values for dashboard
        valUnder6 = 0;
        valFrom6To18 = 0;
        valOver18 = political;
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
      existing = await DailyReport.findOne({ date: selectedDate, centerId: cId, type: 'admin_general' });
    } else if (!isAdmin) {
      existing = await DailyReport.findOne({ date: selectedDate, unitId: uId, type: 'commune' });
    }

    if (existing) {
      // Update
      const isCommuneRecord = existing.type === 'commune';
      const oldUnder6 = (isAdmin && !isCommuneRecord) ? existing.adminUnder6 : existing.under6;
      const oldFrom6To18 = (isAdmin && !isCommuneRecord) ? existing.adminFrom6To18 : existing.from6To18;
      const oldOver18 = (isAdmin && !isCommuneRecord) ? existing.adminOver18 : existing.over18;

      if (isAdmin) {
        if (isCommuneRecord) {
          existing.under6 = valUnder6;
          existing.from6To18 = valFrom6To18;
          existing.over18 = valOver18;
          existing.centerId = null; // Decouple commune report from station
        } else {
          existing.adminUnder6 = valUnder6;
          existing.adminFrom6To18 = valFrom6To18;
          existing.adminOver18 = valOver18;
          existing.adminWorkplace = workplace;
          existing.adminWorkers = workers;
          existing.adminChildren = children;
          existing.adminPolitical = political;
          existing.adminOthers = others;
          existing.adminIsPolitical = isPoliticalInput;
          if (isGeneralAdminInput) {
            existing.unitId = uId;
            existing.centerId = cId;
            existing.type = 'admin_general';
            existing.adminIncludeInTotal = false;
          } else {
            existing.unitId = null;
            existing.centerId = null;
            existing.type = isPoliticalInput ? 'political' : 'workplace';
            existing.adminIncludeInTotal = !isPoliticalInput && (adminIncludeInTotal === 'true' || adminIncludeInTotal === true);
          }
        }
      } else {
        existing.under6 = valUnder6;
        existing.from6To18 = valFrom6To18;
        existing.over18 = valOver18;
        existing.type = 'commune';
        existing.centerId = null; // Decouple commune report from station
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
            : (isPoliticalInput
              ? `Cập nhật số liệu CQ chính trị [${workplace}] ngày ${date}: Số CBCC CV NLĐ (${workers}), Số đã KSK (${political})`
              : `Cập nhật đơn vị KSK [${workplace}] ngày ${date}: CN/VC/NLĐ (${workers}), Trẻ em (${children}), HT chính trị (${political}), Khác (${others})`))
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
          createData.adminIsPolitical = false;
          createData.adminIncludeInTotal = false;
          createData.type = 'admin_general';
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
          createData.adminIsPolitical = isPoliticalInput;
          createData.adminIncludeInTotal = !isPoliticalInput && (adminIncludeInTotal === 'true' || adminIncludeInTotal === true);
          createData.type = isPoliticalInput ? 'political' : 'workplace';
        }

        createData.under6 = 0;
        createData.from6To18 = 0;
        createData.over18 = 0;
      } else {
        createData.unitId = uId;
        createData.centerId = null; // Decouple commune report from station
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
        createData.adminIsPolitical = false;
        createData.adminIncludeInTotal = false;
        createData.type = 'commune';
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
            : (isPoliticalInput
              ? `Nhập mới số liệu CQ chính trị [${workplace}] ngày ${date}: Số CBCC CV NLĐ (${workers}), Số đã KSK (${political})`
              : `Nhập mới đơn vị KSK [${workplace}] ngày ${date}: CN/VC/NLĐ (${workers}), Trẻ em (${children}), HT chính trị (${political}), Khác (${others})`))
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

    // Block deleting commune reports (Số liệu do Xã/Phường tự nhập)
    if (report.type === 'commune') {
      return res.redirect(`/input?date=${date}&unitId=${unitId}&error=${encodeURIComponent('Không được phép xóa số liệu của Xã/Phường tự nhập')}`);
    }

    // Delete the document entirely since they are separate documents
    await DailyReport.deleteOne({ _id: reportId });

    if (isAdmin) {
      const workplace = report.adminWorkplace || '';
      if (!workplace || workplace.trim() === '') {
        // Log deletion of admin general report
        await AuditLog.create({
          userId: req.session.userId,
          username: req.session.username,
          action: 'DELETE',
          targetType: 'REPORT',
          details: `Xóa số liệu Sở nhập [${centerName}] ngày ${formattedDate}: Dưới 6 tuổi (${report.adminUnder6}), 6-18 tuổi (${report.adminFrom6To18}), Trên 18 tuổi (${report.adminOver18})`
        });
      } else {
        // Log deletion of workplace/political report
        await AuditLog.create({
          userId: req.session.userId,
          username: req.session.username,
          action: 'DELETE',
          targetType: 'REPORT',
          details: `Xóa đơn vị KSK [${workplace}] tại [${centerName}] ngày ${formattedDate}`
        });
      }
    } else {
      // Log deletion of commune report
      await AuditLog.create({
        userId: req.session.userId,
        username: req.session.username,
        action: 'DELETE',
        targetType: 'REPORT',
        details: `Xóa số liệu [${centerName}] ngày ${formattedDate} (Xã/Phường nhập): Dưới 6 tuổi (${report.under6}), 6-18 tuổi (${report.from6To18}), Trên 18 tuổi (${report.over18})`
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
  const { residentPopulation, localManagedPopulation, date } = req.body;

  let targetUnitId = req.session.userId;
  if (req.session.userRole === 'admin' && req.body.unitId) {
    targetUnitId = req.body.unitId;
  }

  try {
    const unit = await User.findById(targetUnitId);
    if (!unit || unit.role !== 'unit') {
      return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&error=${encodeURIComponent('Đơn vị không hợp lệ')}`);
    }

    const oldPop = unit.residentPopulation;
    const oldLocPop = unit.localManagedPopulation || 0;
    const valLocPop = parseInt(localManagedPopulation) || 0;

    let detailsMsg = '';

    if (req.session.userRole === 'admin') {
      // Admin can update both fields
      const valPop = parseInt(residentPopulation) || 0;
      unit.residentPopulation = valPop;
      unit.localManagedPopulation = valLocPop;
      detailsMsg = `Cập nhật nhân khẩu (Admin) cho đơn vị ${unit.unitName}: Tổng NK (${oldPop.toLocaleString('vi-VN')} -> ${valPop.toLocaleString('vi-VN')}), NK ĐPQL (${oldLocPop.toLocaleString('vi-VN')} -> ${valLocPop.toLocaleString('vi-VN')})`;
    } else {
      // Regular unit can only update localManagedPopulation
      unit.localManagedPopulation = valLocPop;
      detailsMsg = `Cập nhật nhân khẩu địa phương quản lý cho đơn vị ${unit.unitName}: ${oldLocPop.toLocaleString('vi-VN')} -> ${valLocPop.toLocaleString('vi-VN')}`;
    }

    await unit.save();

    // Log update
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'UPDATE',
      targetType: 'USER',
      details: detailsMsg
    });

    return res.redirect(`/input?date=${date}&unitId=${targetUnitId}&success=${encodeURIComponent('Cập nhật số liệu nhân khẩu thành công!')}`);
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
// ROUTES: ADMIN SYSTEM CONFIGURATION
// -------------------------------------------------------------

app.get('/admin/config', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const dashboardNoteText = await getConfigValue('dashboard_note_text', '* Ghi chú: Số đã KSK toàn tỉnh = Lũy kế 90 ngày đêm + Số đã KSK 6 tháng đầu năm + CBCC + CNLĐ - 40.000(người cao tuổi đã khám 6 tháng đầu năm)');
    const dashboardNoteVisible = await getConfigValue('dashboard_note_visible', true);
    const allowPastDateInput = await getConfigValue('allow_past_date_input', false);
    const includeCnldCbccvc = await getConfigValue('include_cnld_cbccvc_in_total', true);
    const includeTehs = await getConfigValue('include_tehs_in_total', true);
    const unitSortType = await getConfigValue('unit_sort_type', 'stt');

    const grandResidentPopulationConfig = await getConfigValue('grand_resident_population', 3194187);
    const grandFirstHalfCheckedConfig = await getConfigValue('grand_first_half_checked', 833233);
    const campaignTargetConfig = await getConfigValue('campaign_target', 2128099);
    const campaignOffsetConfig = await getConfigValue('campaign_offset', 40000);

    res.render('admin/config', {
      user: {
        id: req.session.userId,
        username: req.session.username,
        role: req.session.userRole,
        unitName: req.session.unitName
      },
      dashboardNoteText,
      dashboardNoteVisible,
      allowPastDateInput,
      includeCnldCbccvc,
      includeTehs,
      unitSortType,
      grandResidentPopulationConfig,
      grandFirstHalfCheckedConfig,
      campaignTargetConfig,
      campaignOffsetConfig,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('GET admin config error:', error);
    res.status(500).send('Lỗi hệ thống khi tải trang cấu hình');
  }
});

app.post('/admin/dashboard-note-config', requireAuth, async (req, res) => {
  if (req.session.userRole !== 'admin') {
    return res.status(403).send('Bạn không có quyền thực hiện hành động này.');
  }

  const {
    noteText,
    noteVisible,
    allowPastDateInput,
    includeCnldCbccvc,
    includeTehs,
    unitSortType,
    date,
    unitId,
    grandResidentPopulation,
    grandFirstHalfChecked,
    campaignTarget,
    campaignOffset
  } = req.body;

  const isVisible = noteVisible === 'true' || noteVisible === true;
  const isAllowPast = allowPastDateInput === 'true' || allowPastDateInput === true;
  const isIncludeCnldCbccvc = includeCnldCbccvc === 'true' || includeCnldCbccvc === true;
  const isIncludeTehs = includeTehs === 'true' || includeTehs === true;

  const parsedResidentPopulation = parseInt(grandResidentPopulation);
  const parsedFirstHalfChecked = parseInt(grandFirstHalfChecked);
  const parsedCampaignTarget = parseInt(campaignTarget);
  const parsedCampaignOffset = parseInt(campaignOffset);

  try {
    await SystemConfig.findOneAndUpdate(
      { key: 'dashboard_note_text' },
      { value: noteText || '' },
      { upsert: true, new: true }
    );

    await SystemConfig.findOneAndUpdate(
      { key: 'dashboard_note_visible' },
      { value: isVisible },
      { upsert: true, new: true }
    );

    await SystemConfig.findOneAndUpdate(
      { key: 'allow_past_date_input' },
      { value: isAllowPast },
      { upsert: true, new: true }
    );

    await SystemConfig.findOneAndUpdate(
      { key: 'include_cnld_cbccvc_in_total' },
      { value: isIncludeCnldCbccvc },
      { upsert: true, new: true }
    );

    await SystemConfig.findOneAndUpdate(
      { key: 'include_tehs_in_total' },
      { value: isIncludeTehs },
      { upsert: true, new: true }
    );

    if (unitSortType && ['stt', 'cumulative_desc', 'cumulative_asc', 'completion_rate_desc', 'completion_rate_asc', 'completion_rate', 'alphabet'].includes(unitSortType)) {
      await SystemConfig.findOneAndUpdate(
        { key: 'unit_sort_type' },
        { value: unitSortType },
        { upsert: true, new: true }
      );
    }

    if (!isNaN(parsedResidentPopulation)) {
      await SystemConfig.findOneAndUpdate(
        { key: 'grand_resident_population' },
        { value: parsedResidentPopulation },
        { upsert: true, new: true }
      );
    }

    if (!isNaN(parsedFirstHalfChecked)) {
      await SystemConfig.findOneAndUpdate(
        { key: 'grand_first_half_checked' },
        { value: parsedFirstHalfChecked },
        { upsert: true, new: true }
      );
    }

    if (!isNaN(parsedCampaignTarget)) {
      await SystemConfig.findOneAndUpdate(
        { key: 'campaign_target' },
        { value: parsedCampaignTarget },
        { upsert: true, new: true }
      );
    }

    if (!isNaN(parsedCampaignOffset)) {
      await SystemConfig.findOneAndUpdate(
        { key: 'campaign_offset' },
        { value: parsedCampaignOffset },
        { upsert: true, new: true }
      );
    }

    // Log update
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'UPDATE',
      targetType: 'TARGET',
      details: `Cập nhật cấu hình hệ thống: kiểu sắp xếp=${unitSortType}, hiển thị ghi chú=${isVisible}, ghi chú="${noteText}", cho phép nhập ngày cũ=${isAllowPast}, tính tổng CNLĐ và CBCCVC=${isIncludeCnldCbccvc}, tính tổng TE&HS=${isIncludeTehs}, tổng dân số toàn tỉnh=${parsedResidentPopulation}, đã khám 6T đầu năm=${parsedFirstHalfChecked}, chỉ tiêu chiến dịch=${parsedCampaignTarget}, sai số điều chỉnh=${parsedCampaignOffset}`
    });

    return res.redirect(`/admin/config?success=${encodeURIComponent('Cập nhật cấu hình hệ thống thành công!')}`);
  } catch (error) {
    console.error('Update dashboard note config error:', error);
    return res.redirect(`/admin/config?error=${encodeURIComponent('Lỗi hệ thống khi cập nhật cấu hình ghi chú')}`);
  }
});

// -------------------------------------------------------------
// ROUTES: ADMIN HEALTH CENTERS MANAGEMENT (DANH MỤC TRẠM Y TẾ)
// -------------------------------------------------------------

app.get('/admin/centers', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const units = await User.find({ role: 'unit' });
    units.sort((a, b) => {
      const orderA = a.order || 0;
      const orderB = b.order || 0;
      if (orderA !== orderB) return orderA - orderB;

      const getUnitType = (name) => {
        if (name.startsWith('Phường')) return 1;
        if (name.startsWith('Xã')) return 2;
        return 3;
      };
      const typeA = getUnitType(a.unitName || '');
      const typeB = getUnitType(b.unitName || '');
      if (typeA !== typeB) return typeA - typeB;

      const nameA = (a.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
      const nameB = (b.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
      return nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' });
    });
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
    const units = await User.find({ role: 'unit' });
    units.sort((a, b) => {
      const orderA = a.order || 0;
      const orderB = b.order || 0;
      if (orderA !== orderB) return orderA - orderB;

      const getUnitType = (name) => {
        if (name.startsWith('Phường')) return 1;
        if (name.startsWith('Xã')) return 2;
        return 3;
      };
      const typeA = getUnitType(a.unitName || '');
      const typeB = getUnitType(b.unitName || '');
      if (typeA !== typeB) return typeA - typeB;

      const nameA = (a.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
      const nameB = (b.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
      return nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' });
    });
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
  const { unitId, planTarget, residentPopulation, localManagedPopulation, firstHalfChecked, contactName, contactPhone, contactEmail } = req.body;

  try {
    const unit = await User.findById(unitId);
    if (!unit || unit.role !== 'unit') {
      return res.redirect('/admin/targets?error=' + encodeURIComponent('Không tìm thấy đơn vị hợp lệ'));
    }

    const oldTarget = unit.planTarget;
    const newTarget = parseInt(planTarget) || 0;
    const oldPop = unit.residentPopulation;
    const newPop = parseInt(residentPopulation) || 0;
    const oldLocPop = unit.localManagedPopulation || 0;
    const newLocPop = parseInt(localManagedPopulation) || 0;
    const oldFirstHalf = unit.firstHalfChecked;
    const newFirstHalf = parseInt(firstHalfChecked) || 0;

    unit.planTarget = newTarget;
    unit.residentPopulation = newPop;
    unit.localManagedPopulation = newLocPop;
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
      details: `Thay đổi cấu hình đơn vị ${unit.unitName}: Chỉ tiêu kế hoạch (${oldTarget}->${newTarget}), Tổng NK (${oldPop}->${newPop}), NK ĐPQL (${oldLocPop}->${newLocPop}), Khám 6T đầu năm (${oldFirstHalf}->${newFirstHalf}), Họ tên liên hệ (${unit.contactName}), SĐT (${unit.contactPhone}), Email (${unit.contactEmail})`
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

app.post('/admin/global-metrics', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { date, cnldCount, tehsCount } = req.body;
    if (!date) {
      return res.redirect(`/input?error=${encodeURIComponent('Ngày không hợp lệ')}`);
    }

    const selectedDate = parseDateUTC(date);
    const cnldVal = cnldCount !== undefined ? (parseInt(cnldCount) || 0) : undefined;
    const tehsVal = tehsCount !== undefined ? (parseInt(tehsCount) || 0) : undefined;

    const existing = await BytLinkage.findOne({ date: selectedDate });
    if (existing) {
      if (cnldVal !== undefined) existing.cnldCount = cnldVal;
      if (tehsVal !== undefined) existing.tehsCount = tehsVal;
      existing.updatedBy = req.session.userId;
      await existing.save();
    } else {
      await BytLinkage.create({
        date: selectedDate,
        count: 0,
        cnldCount: cnldVal !== undefined ? cnldVal : 0,
        tehsCount: tehsVal !== undefined ? tehsVal : 0,
        updatedBy: req.session.userId
      });
    }

    // Stop resetting other dates to 0 so we can preserve historical time-series data

    // Log this action
    let details = `Cập nhật số liệu KSK tỉnh ngày ${date}:`;
    if (cnldVal !== undefined) details += ` CNLĐ = ${cnldVal}`;
    if (tehsVal !== undefined) details += ` TE&HS = ${tehsVal}`;

    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'UPDATE',
      targetType: 'REPORT',
      details
    });

    return res.redirect(`/input?date=${date}&success=${encodeURIComponent('Đã cập nhật số liệu KSK')}`);
  } catch (error) {
    console.error('POST global-metrics error:', error);
    return res.redirect(`/input?error=${encodeURIComponent('Lỗi lưu số liệu KSK')}`);
  }
});

app.post('/admin/byt-linkage/delete', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { linkageId, date } = req.body;
    const item = await BytLinkage.findById(linkageId);
    if (item) {
      const formattedDate = formatDateString(item.date);
      const cnldToShift = item.cnldCount || 0;
      const tehsToShift = item.tehsCount || 0;
      await BytLinkage.deleteOne({ _id: linkageId });

      // If we deleted the record that held the global metric value, shift it to another record
      if (cnldToShift > 0 || tehsToShift > 0) {
        const remaining = await BytLinkage.findOne().sort({ date: -1 });
        if (remaining) {
          if (cnldToShift > 0) remaining.cnldCount = cnldToShift;
          if (tehsToShift > 0) remaining.tehsCount = tehsToShift;
          await remaining.save();
        } else {
          // If no remaining records, recreate a placeholder to preserve the global count
          await BytLinkage.create({
            date: item.date,
            count: 0,
            cnldCount: cnldToShift,
            tehsCount: tehsToShift,
            updatedBy: req.session.userId
          });
        }
      }

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
// ROUTES: ADMIN UNIT ACCOUNTS MANAGEMENT (QUẢN LÝ TÀI KHOẢN ĐƠN VỊ)
// -------------------------------------------------------------

app.get('/admin/units', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const units = await User.find({ role: 'unit' });
    units.sort((a, b) => {
      const orderA = a.order || 0;
      const orderB = b.order || 0;
      if (orderA !== orderB) return orderA - orderB;

      const getUnitType = (name) => {
        if (name.startsWith('Phường')) return 1;
        if (name.startsWith('Xã')) return 2;
        return 3;
      };
      const typeA = getUnitType(a.unitName || '');
      const typeB = getUnitType(b.unitName || '');
      if (typeA !== typeB) return typeA - typeB;

      const nameA = (a.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
      const nameB = (b.unitName || '').replace(/^(Xã|Phường)\s+/i, '').trim();
      return nameA.localeCompare(nameB, 'vi', { sensitivity: 'base' });
    });
    res.render('admin/units', {
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
    console.error('GET units error:', error);
    res.status(500).send('Lỗi tải danh sách tài khoản đơn vị');
  }
});

app.post('/admin/units/add', requireAuth, requireRole('admin'), async (req, res) => {
  const { unitName, username, password, contactName, contactPhone, contactEmail, order } = req.body;
  try {
    if (!unitName || !username || !password) {
      return res.redirect('/admin/units?error=' + encodeURIComponent('Vui lòng điền đầy đủ các thông tin bắt buộc'));
    }

    const trimmedUsername = username.toLowerCase().trim();
    const existingUser = await User.findOne({ username: trimmedUsername });
    if (existingUser) {
      return res.redirect('/admin/units?error=' + encodeURIComponent('Tên đăng nhập đã tồn tại trên hệ thống'));
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUnit = await User.create({
      unitName: unitName.trim(),
      username: trimmedUsername,
      password: hashedPassword,
      contactName: contactName ? contactName.trim() : '',
      contactPhone: contactPhone ? contactPhone.trim() : '',
      contactEmail: contactEmail ? contactEmail.trim() : '',
      order: Number(order) || 0,
      role: 'unit'
    });

    // Log the creation
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'CREATE',
      targetType: 'USER',
      details: `Tạo tài khoản đơn vị mới: ${newUnit.unitName} (${newUnit.username})`
    });

    res.redirect('/admin/units?success=' + encodeURIComponent('Tạo tài khoản đơn vị mới thành công!'));
  } catch (error) {
    console.error('POST units/add error:', error);
    res.redirect('/admin/units?error=' + encodeURIComponent('Đã xảy ra lỗi khi tạo tài khoản đơn vị'));
  }
});

app.post('/admin/units/update', requireAuth, requireRole('admin'), async (req, res) => {
  const { unitId, unitName, username, contactName, contactPhone, contactEmail, order, residentPopulation, localManagedPopulation } = req.body;
  try {
    if (!unitId || !unitName || !username) {
      return res.redirect('/admin/units?error=' + encodeURIComponent('Vui lòng điền đầy đủ các thông tin bắt buộc'));
    }

    const unit = await User.findById(unitId);
    if (!unit) {
      return res.redirect('/admin/units?error=' + encodeURIComponent('Không tìm thấy tài khoản đơn vị'));
    }

    const trimmedUsername = username.toLowerCase().trim();
    if (trimmedUsername !== unit.username) {
      const existingUser = await User.findOne({ username: trimmedUsername });
      if (existingUser) {
        return res.redirect('/admin/units?error=' + encodeURIComponent('Tên đăng nhập mới đã tồn tại trên hệ thống'));
      }
    }

    const oldName = unit.unitName;
    const oldUsername = unit.username;

    unit.unitName = unitName.trim();
    unit.username = trimmedUsername;
    unit.contactName = contactName ? contactName.trim() : '';
    unit.contactPhone = contactPhone ? contactPhone.trim() : '';
    unit.contactEmail = contactEmail ? contactEmail.trim() : '';
    unit.order = Number(order) || 0;
    unit.residentPopulation = parseInt(residentPopulation) || 0;
    unit.localManagedPopulation = parseInt(localManagedPopulation) || 0;

    await unit.save();

    // Log the update
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'UPDATE',
      targetType: 'USER',
      details: `Cập nhật thông tin đơn vị: ${oldName} (${oldUsername}) -> ${unit.unitName} (${unit.username}), Tổng NK: ${unit.residentPopulation}, NK ĐPQL: ${unit.localManagedPopulation}`
    });

    res.redirect('/admin/units?success=' + encodeURIComponent('Cập nhật thông tin đơn vị thành công!'));
  } catch (error) {
    console.error('POST units/update error:', error);
    res.redirect('/admin/units?error=' + encodeURIComponent('Đã xảy ra lỗi khi cập nhật thông tin đơn vị'));
  }
});

app.post('/admin/units/reset-password', requireAuth, requireRole('admin'), async (req, res) => {
  const { unitId, newPassword, confirmPassword } = req.body;
  try {
    if (!unitId || !newPassword || !confirmPassword) {
      return res.redirect('/admin/units?error=' + encodeURIComponent('Vui lòng điền đầy đủ thông tin mật khẩu'));
    }

    if (newPassword !== confirmPassword) {
      return res.redirect('/admin/units?error=' + encodeURIComponent('Mật khẩu và xác nhận mật khẩu không khớp'));
    }

    const unit = await User.findById(unitId);
    if (!unit) {
      return res.redirect('/admin/units?error=' + encodeURIComponent('Không tìm thấy tài khoản đơn vị'));
    }

    unit.password = await bcrypt.hash(newPassword, 10);
    await unit.save();

    // Log the reset
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'UPDATE',
      targetType: 'USER',
      details: `Đổi mật khẩu cho đơn vị: ${unit.unitName} (${unit.username})`
    });

    res.redirect('/admin/units?success=' + encodeURIComponent(`Đã đổi mật khẩu cho đơn vị ${unit.unitName} thành công!`));
  } catch (error) {
    console.error('POST units/reset-password error:', error);
    res.redirect('/admin/units?error=' + encodeURIComponent('Đã xảy ra lỗi khi đổi mật khẩu đơn vị'));
  }
});

app.post('/admin/units/delete/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const unitId = req.params.id;
  try {
    const unit = await User.findById(unitId);
    if (!unit) {
      return res.redirect('/admin/units?error=' + encodeURIComponent('Không tìm thấy tài khoản đơn vị'));
    }

    // Prevent deleting itself
    if (unitId === req.session.userId) {
      return res.redirect('/admin/units?error=' + encodeURIComponent('Bạn không thể xóa tài khoản của chính mình'));
    }

    await User.findByIdAndDelete(unitId);

    // Log the delete
    await AuditLog.create({
      userId: req.session.userId,
      username: req.session.username,
      action: 'DELETE',
      targetType: 'USER',
      details: `Xóa tài khoản đơn vị: ${unit.unitName} (${unit.username})`
    });

    res.redirect('/admin/units?success=' + encodeURIComponent('Đã xóa tài khoản đơn vị thành công!'));
  } catch (error) {
    console.error('POST units/delete error:', error);
    res.redirect('/admin/units?error=' + encodeURIComponent('Đã xảy ra lỗi khi xóa tài khoản đơn vị'));
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
