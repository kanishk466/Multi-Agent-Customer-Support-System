# Technical Troubleshooting Guide

## Login Not Working

First ask the customer to clear the browser cache and cookies for the site,
then retry in a private or incognito window. If login still fails, ask whether
they see an "account locked" message. Five failed attempts lock an account for
15 minutes. A password reset from the login page clears the lock immediately
and the new password takes effect within 60 seconds.

## Password Reset Not Received

Password reset emails are sent from no-reply@example.com and usually arrive
within 2 minutes. Ask the customer to check the spam or promotions folder and
to add the sender to the safe list. Corporate mail filters block the email
most often. If nothing arrives after 10 minutes, the address on file is
probably a typo and the support team has to change it manually.

## App Running Slowly

Ask which page is slow and whether the problem happens on one network or
everywhere. Slowness on a single network is usually DNS or VPN related.
Otherwise ask the customer to disable browser extensions, especially ad
blockers and privacy extensions, which intercept API calls. Clearing the
service worker from the application tab fixes stale cache issues that cause
repeated slow loads.

## Two Factor Authentication Lost

If a customer lost their authenticator device and has backup codes, any one
backup code restores access from the security settings page. Without backup
codes the identity verification process is required. This needs a photo ID
and takes 1 to 2 business days. Support must never bypass identity
verification, even when the customer is upset.

## Data Export Failing

Exports larger than 1 GB are prepared asynchronously and a download link is
emailed when ready. The link expires after 24 hours. If an export fails
repeatedly, ask the customer to narrow the date range. Concurrent exports are
limited to one per account, so a second export request cancels the first.

## API Errors

A 429 response means the customer hit the rate limit of 100 requests per
minute on the standard plan. A 401 means the API key is missing, expired or
revoked. Keys are rotated from the developer settings page and old keys stop
working immediately, so integrations must be updated at the same time.
