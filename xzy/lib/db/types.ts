/** Channel listing lifecycle. A channel is only copyable once an admin approves it. */
export type ChannelStatus = "pending" | "approved" | "rejected" | "removed";

export type Channel = {
  id: string;
  chat_id: string;
  title: string | null;
  username: string | null;
  /** Telegram user ID of whoever promoted the bot — our ownership proof. */
  listed_by_tg_id: string | null;
  status: ChannelStatus;
  member_count: number | null;
  listed_at: string;
  approved_at: string | null;
};

export type Call = {
  id: string;
  channel_id: string;
  chat_id: string;
  mint: string;
  message_id: string;
  confidence: string;
  called_at: string;
  called_price_usd: number | null;
  called_mcap: number | null;
  symbol: string | null;
};

export type XzyUser = {
  id: string;
  tg_id: string;
  username: string | null;
  first_name: string | null;
  created_at: string;
};
