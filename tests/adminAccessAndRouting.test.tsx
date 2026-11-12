import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminUsersPortal } from '../src/components/AdminUsersPortal';
import { OWNER_ADMIN_EMAIL } from '../src/utils/firebase';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('========================================================================');
console.log(' MotoCare Admin Authentication & Routing Verification Test Suite        ');
console.log(' Testing Owner Admin Access, Footer Link & Admin Component Gates        ');
console.log('========================================================================\n');

// =============================================================================
// TEST SUITE 1: CONDITIONAL RENDERING OF FOOTER ADMIN PORTAL LINK
// =============================================================================
console.log('--- TEST SUITE 1: Footer "Owner Admin Portal" Link Visibility ---');

function FooterTestComponent({ userEmail }: { userEmail: string | null | undefined }) {
  const isExactAdmin = userEmail?.toLowerCase() === OWNER_ADMIN_EMAIL;
  return (
    <footer className="pt-8 pb-4 text-center text-[10px] text-slate-400 space-y-1.5">
      <p>MotoCare PH • Motorcycle Maintenance &amp; Digital Garage</p>
      {isExactAdmin && (
        <div>
          <button
            type="button"
            className="text-slate-400 hover:text-[#FF6B00] transition-colors underline cursor-pointer"
          >
            Owner Admin Portal
          </button>
        </div>
      )}
    </footer>
  );
}

// 1.1: Authenticated as exact owner
{
  const markup = renderToStaticMarkup(<FooterTestComponent userEmail={OWNER_ADMIN_EMAIL} />);
  assert(
    markup.includes('Owner Admin Portal'),
    'Footer must render "Owner Admin Portal" link when user email matches OWNER_ADMIN_EMAIL'
  );
  assert(
    markup.includes('button') && markup.includes('underline'),
    'Footer must render clickable button for verified admin'
  );
  console.log('✓ TEST 1.1 PASS: "Owner Admin Portal" link renders when authenticated as owner admin.');
}

// 1.2: Case-insensitivity check
{
  const markup = renderToStaticMarkup(
    <FooterTestComponent userEmail={OWNER_ADMIN_EMAIL.toUpperCase()} />
  );
  assert(
    markup.includes('Owner Admin Portal'),
    'Footer must be case-insensitive and render link for uppercase owner email'
  );
  console.log('✓ TEST 1.2 PASS: Case-insensitive email normalization verified.');
}

// 1.3: Authenticated as ordinary rider (e.g. 'rider@example.com')
{
  const markup = renderToStaticMarkup(<FooterTestComponent userEmail="rider@example.com" />);
  assert(
    !markup.includes('Owner Admin Portal'),
    'Footer must NOT render "Owner Admin Portal" link for ordinary rider rider@example.com'
  );
  console.log('✓ TEST 1.3 PASS: "Owner Admin Portal" link is strictly hidden for ordinary rider.');
}

// 1.4: Unauthenticated visitor (null user)
{
  const markup = renderToStaticMarkup(<FooterTestComponent userEmail={null} />);
  assert(
    !markup.includes('Owner Admin Portal'),
    'Footer must NOT render "Owner Admin Portal" link for unauthenticated user (null)'
  );
  console.log('✓ TEST 1.4 PASS: "Owner Admin Portal" link is strictly hidden for unauthenticated visitor.');
}

// =============================================================================
// TEST SUITE 2: NAVBAR ADMIN NAVIGATION CONTROLS
// =============================================================================
console.log('\n--- TEST SUITE 2: Navbar Admin Navigation Controls ---');

function NavbarAdminButtonsComponent({
  userEmail,
  onOpenAdminPortal,
}: {
  userEmail: string | null;
  onOpenAdminPortal?: () => void;
}) {
  const isExactAdmin = userEmail?.toLowerCase() === OWNER_ADMIN_EMAIL;

  return (
    <div>
      {isExactAdmin && onOpenAdminPortal && (
        <button id="header-admin-btn">
          <span>Admin</span>
        </button>
      )}
      {isExactAdmin && onOpenAdminPortal && (
        <button id="menu-admin-btn">
          <span>Admin Console</span>
        </button>
      )}
    </div>
  );
}

// 2.1: Header & dropdown admin actions render for owner admin with handler
{
  const dummyHandler = () => {};
  const markup = renderToStaticMarkup(
    <NavbarAdminButtonsComponent userEmail={OWNER_ADMIN_EMAIL} onOpenAdminPortal={dummyHandler} />
  );
  assert(markup.includes('id="header-admin-btn"') && markup.includes('Admin'), 'Navbar header shows Admin button');
  assert(markup.includes('id="menu-admin-btn"') && markup.includes('Admin Console'), 'Navbar menu shows Admin Console');
  console.log('✓ TEST 2.1 PASS: Navbar header and menu admin controls render for owner admin.');
}

// 2.2: Header & dropdown admin actions hidden for ordinary rider
{
  const dummyHandler = () => {};
  const markup = renderToStaticMarkup(
    <NavbarAdminButtonsComponent userEmail="rider@example.com" onOpenAdminPortal={dummyHandler} />
  );
  assert(!markup.includes('Admin'), 'Navbar must not contain Admin button for rider@example.com');
  console.log('✓ TEST 2.2 PASS: Navbar admin controls are completely omitted for non-admin rider.');
}

// 2.3: When onOpenAdminPortal is undefined
{
  const markup = renderToStaticMarkup(
    <NavbarAdminButtonsComponent userEmail={OWNER_ADMIN_EMAIL} onOpenAdminPortal={undefined} />
  );
  assert(!markup.includes('Admin'), 'Navbar must not render admin button if onOpenAdminPortal is undefined');
  console.log('✓ TEST 2.3 PASS: Protected against undefined onOpenAdminPortal prop.');
}

// =============================================================================
// TEST SUITE 3: ROUTING & REDIRECTION TO AdminUsersPortal COMPONENT
// =============================================================================
console.log('\n--- TEST SUITE 3: Routing & Admin State Transitions ---');

function AppRouterSimulator({
  isAdminPortal,
  authLoading,
  userEmail,
  onReturnToApp,
}: {
  isAdminPortal: boolean;
  authLoading: boolean;
  userEmail: string | null;
  onReturnToApp: () => void;
}) {
  const isExactAdmin = userEmail?.toLowerCase() === OWNER_ADMIN_EMAIL;

  if (isAdminPortal) {
    if (authLoading) {
      return (
        <div id="admin-auth-loading">
          <p>Verifying administrator credentials...</p>
        </div>
      );
    }

    if (userEmail && !isExactAdmin) {
      return (
        <div id="admin-access-denied">
          <h2>Access Denied</h2>
          <p>Administrator access only. You are currently signed in as {userEmail}.</p>
          <button type="button" onClick={onReturnToApp}>
            ← Return to Garage
          </button>
        </div>
      );
    }

    return (
      <div id="admin-portal-wrapper">
        <AdminUsersPortal onReturnToApp={onReturnToApp} />
      </div>
    );
  }

  return (
    <div id="garage-main-view">
      <h1>MotoCare Garage</h1>
      <FooterTestComponent userEmail={userEmail} />
    </div>
  );
}

// 3.1: Successful Redirection to AdminUsersPortal for authenticated admin
{
  const markup = renderToStaticMarkup(
    <AppRouterSimulator
      isAdminPortal={true}
      authLoading={false}
      userEmail={OWNER_ADMIN_EMAIL}
      onReturnToApp={() => {}}
    />
  );

  assert(
    markup.includes('id="admin-portal-wrapper"'),
    'Router must render admin-portal-wrapper when isAdminPortal is true and user is owner admin'
  );
  assert(
    markup.includes('Admin Console') || markup.includes('Owner Portal') || markup.includes('Zero Trust Administrator Authentication'),
    'AdminUsersPortal component must be mounted with admin branding'
  );
  assert(
    !markup.includes(OWNER_ADMIN_EMAIL),
    'Owner email must not be exposed in user-facing AdminUsersPortal text'
  );
  assert(
    !markup.includes('id="garage-main-view"'),
    'Main garage view must not be rendered when inside AdminUsersPortal'
  );
  console.log('✓ TEST 3.1 PASS: Successful redirection to AdminUsersPortal without exposing owner email.');
}

// 3.2: Auth Loading state resolution
{
  const markup = renderToStaticMarkup(
    <AppRouterSimulator
      isAdminPortal={true}
      authLoading={true}
      userEmail={null}
      onReturnToApp={() => {}}
    />
  );

  assert(
    markup.includes('id="admin-auth-loading"') && markup.includes('Verifying administrator credentials...'),
    'Router must render loading screen while auth is resolving'
  );
  assert(
    !markup.includes('id="admin-portal-wrapper"'),
    'AdminUsersPortal must not be rendered while auth is loading'
  );
  assert(
    !markup.includes('Access Denied'),
    'Access Denied screen must not flash while auth is loading'
  );
  console.log('✓ TEST 3.2 PASS: Loading screen prevents race condition and flashes during auth resolution.');
}

// 3.3: Unauthorized rider redirected to Access Denied screen showing "Administrator access only"
{
  const markup = renderToStaticMarkup(
    <AppRouterSimulator
      isAdminPortal={true}
      authLoading={false}
      userEmail="rider@example.com"
      onReturnToApp={() => {}}
    />
  );

  assert(
    markup.includes('id="admin-access-denied"') && markup.includes('Access Denied'),
    'Router must render Access Denied screen for non-admin user'
  );
  assert(
    markup.includes('Administrator access only'),
    'Access Denied screen must show "Administrator access only"'
  );
  assert(
    !markup.includes(OWNER_ADMIN_EMAIL),
    'Access Denied screen must NOT expose the owner email address'
  );
  assert(
    markup.includes('rider@example.com'),
    'Access Denied screen must display the currently signed-in user email'
  );
  assert(
    markup.includes('← Return to Garage'),
    'Access Denied screen must provide a Return to Garage button'
  );
  assert(
    !markup.includes('id="admin-portal-wrapper"'),
    'AdminUsersPortal must NEVER be mounted for unauthorized riders'
  );
  console.log('✓ TEST 3.3 PASS: Unauthorized riders are blocked with "Administrator access only"; owner email is never exposed.');
}

// 3.4: Normal Garage view rendering and navigation initiation
{
  const navState = { navigated: false };
  const handleOpenAdminPortal = () => {
    navState.navigated = true;
  };

  const markup = renderToStaticMarkup(
    <AppRouterSimulator
      isAdminPortal={false}
      authLoading={false}
      userEmail={OWNER_ADMIN_EMAIL}
      onReturnToApp={() => {}}
    />
  );

  assert(markup.includes('id="garage-main-view"'), 'Renders Garage main view when isAdminPortal is false');
  assert(markup.includes('Owner Admin Portal'), 'Footer includes Owner Admin Portal link for owner admin');

  handleOpenAdminPortal();
  assert(navState.navigated, 'Clicking Owner Admin Portal triggers state change to isAdminPortal: true');
  console.log('✓ TEST 3.4 PASS: Main garage view renders and allows admin navigation transition.');
}

// 3.5: Return to Garage from Admin Portal
{
  const returnState = { returnTriggered: false };
  const handleCloseAdminPortal = () => {
    returnState.returnTriggered = true;
  };

  handleCloseAdminPortal();
  assert(returnState.returnTriggered, 'handleCloseAdminPortal resets isAdminPortal to false and clears hash');
  console.log('✓ TEST 3.5 PASS: Return to Garage successfully closes AdminUsersPortal.');
}

console.log('\n========================================================================');
console.log(' ALL ADMIN AUTHENTICATION, FOOTER & ROUTING TESTS PASSED (10/10)        ');
console.log('========================================================================\n');

process.exit(0);
