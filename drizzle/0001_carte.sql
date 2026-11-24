CREATE TABLE "courier_assignments" (
	"courier_id" text PRIMARY KEY NOT NULL,
	"restaurant_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restaurant_state" (
	"restaurant_id" text PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"dispatched" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
