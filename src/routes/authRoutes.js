import express from 'express';
import { verifyStaffCredentials } from '../auth.js';
import { escapeHtml, layout } from '../views.js';

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session?.staffUser) {
    res.redirect('/staff');
    return;
  }

  const next = req.query.next || '/staff';
  const error = req.query.error === '1';

  const body = `
    <section class="panel narrow">
      <h1>Staff login</h1>
      <p class="muted">Sign in to view live votes and generate reports.</p>
      ${error ? '<p class="error">Invalid username or password.</p>' : ''}
      <form method="post" action="/login" class="stack-form">
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

router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const { username, password, next } = req.body;
  const user = verifyStaffCredentials(username, password);

  if (!user) {
    res.redirect('/login?error=1');
    return;
  }

  req.session.staffUser = user;
  res.redirect(next && next.startsWith('/') ? next : '/staff');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

export default router;
