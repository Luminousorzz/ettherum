ALTER TABLE `custom_services` ADD `github_repo` text;--> statement-breakpoint
ALTER TABLE `custom_services` ADD `github_branch` text DEFAULT 'main';--> statement-breakpoint
ALTER TABLE `custom_services` ADD `build_command` text;--> statement-breakpoint
ALTER TABLE `custom_services` ADD `port` integer;--> statement-breakpoint
ALTER TABLE `custom_services` ADD `tunnel_id` text REFERENCES cloudflare_tunnels(id);--> statement-breakpoint
ALTER TABLE `custom_services` ADD `hostname` text;--> statement-breakpoint
ALTER TABLE `custom_services` ADD `webhook_secret` text;