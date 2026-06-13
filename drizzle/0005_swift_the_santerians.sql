ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint

-- Profile photos live in a public-read "avatars" bucket; each user may only
-- write under their own `{user_id}/...` prefix. Idempotent so re-runs are safe.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;--> statement-breakpoint

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;--> statement-breakpoint
CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');--> statement-breakpoint

DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;--> statement-breakpoint
CREATE POLICY "avatars_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (select auth.uid())::text);--> statement-breakpoint

DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;--> statement-breakpoint
CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (select auth.uid())::text);--> statement-breakpoint

DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;--> statement-breakpoint
CREATE POLICY "avatars_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (select auth.uid())::text);
