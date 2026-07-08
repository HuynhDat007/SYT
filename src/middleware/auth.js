function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/login');
}

function requireRole(role) {
  return function(req, res, next) {
    if (req.session && req.session.userRole === role) {
      return next();
    }
    // Access denied for non-matching roles
    return res.status(403).render('error', { 
      message: 'Bạn không có quyền truy cập trang này.', 
      user: req.session ? { username: req.session.username, role: req.session.userRole, unitName: req.session.unitName } : null 
    });
  };
}

module.exports = {
  requireAuth,
  requireRole
};
