CREATE TABLE `cloudflare_tunnels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`credentials` text NOT NULL,
	`status` text DEFAULT 'inactive' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cloudflare_tunnels_name_unique` ON `cloudflare_tunnels` (`name`);--> statement-breakpoint
CREATE TABLE `tunnel_ingress_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tunnel_id` text NOT NULL,
	`hostname` text NOT NULL,
	`service` text NOT NULL,
	`dns_record_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tunnel_id`) REFERENCES `cloudflare_tunnels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tunnel_ingress_rules_hostname_unique` ON `tunnel_ingress_rules` (`hostname`);