import express from 'express';
import rateLimit from 'express-rate-limit';
import { verifyStaffCredentials } from '../auth.js';
import { safeRedirectPath, requireCsrf, getCsrfToken } from '../security.js';
import { escapeHtml, layout } from '../views.js';

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Try again later.',
});

function loginErrorMessage(code) {
  switch (code) {
    case 'csrf':
      return 'Your session expired. Refresh the page and try again.';
    case 'session':
      return 'Could not start a session. Try again or contact staff.';
    case '1':
    default:
      return 'Invalid username or password.';
  }
}

router.get('/login', (req, res) => {
  if (req.session?.staffUser) {
    res.redirect('/staff');
    return;
  }

  getCsrfToken(req);
  const next = safeRedirectPath(req.query.next, '/staff');
  const errorCode = req.query.error ? String(req.query.error) : '';
  const errorMsg = errorCode ? loginErrorMessage(errorCode) : '';

  const body = `
    <section class="panel narrow">
      <h1>Staff login</h1>
      <p class="muted">Sign in to view live votes and generate reports.</p>
      ${errorMsg ? `<p class="error">${escapeHtml(errorMsg)}</p>` : ''}
      <form method="post" action="/login" class="stack-form">
        ${req.csrfField}
        <input type="hidden" name="next" value="${escapeHtml(next)}">
        <label>
          Username
          <input type="text" name="username" required autocomplete="username">
        </label>
        <label>
          Password
          <input type="password" name="password" required autocomplete="current-password">
        </label>
        <button type="submit" class="btn btn-primary">Sign in</button>
      </form>
    </section>`;

  res.type('html').send(layout({ title: 'Staff login', body }));
});

router.post('/login', loginLimiter, requireCsrf, express.urlencoded({ extended: false }), (req, res) => {
  const { username, password, next } = req.body;
  const user = verifyStaffCredentials(username, password);

  if (!user) {
    res.redirect('/login?error=1');
    return;
  }

  const redirectTo = safeRedirectPath(next, '/staff');
  req.session.regenerate((err) => {
    if (err) {
      console.error('session regenerate failed:', err);
      res.redirect('/login?error=session');
      return;
    }

    getCsrfToken(req);
    req.session.staffUser = user;
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('session save failed:', saveErr);
        res.redirect('/login?error=session');
        return;
      }
      res.redirect(redirectTo);
    });
  });
});

router.post('/logout', requireCsrf, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

export default router;
