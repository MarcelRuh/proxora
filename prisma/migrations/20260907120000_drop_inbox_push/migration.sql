-- Inbox and browser Web Push are gone; Discord/SMTP/webhook channels remain.
DROP TABLE IF EXISTS "InboxRead";
DROP TABLE IF EXISTS "InboxEvent";
DROP TABLE IF EXISTS "PushSubscription";
DELETE FROM "Setting" WHERE "key" = 'push.vapid';
