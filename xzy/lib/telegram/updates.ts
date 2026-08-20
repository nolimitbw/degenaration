/**
 * The subset of Telegram's Update shape that Xzy consumes. Deliberately partial —
 * fields we do not read are not modelled, so it stays obvious what the bot actually
 * depends on.
 */

export type TgUser = {
  id?: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
};

export type TgChat = {
  id?: number;
  type?: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
};

export type TgMessage = {
  message_id?: number;
  from?: TgUser;
  chat?: TgChat;
  text?: string;
  caption?: string;
  date?: number;
  edit_date?: number;
  author_signature?: string;
};

export type TgChatMemberUpdated = {
  chat?: TgChat;
  from?: TgUser;
  date?: number;
  new_chat_member?: { status?: string; user?: TgUser };
  old_chat_member?: { status?: string };
};

export type TgCallbackQuery = {
  id?: string;
  from?: TgUser;
  data?: string;
};

export type TgUpdate = {
  update_id?: number;
  message?: TgMessage;
  channel_post?: TgMessage;
  edited_channel_post?: TgMessage;
  my_chat_member?: TgChatMemberUpdated;
  callback_query?: TgCallbackQuery;
};

/** Statuses that mean the bot can read posts in the chat. */
export const READING_STATUSES = new Set(["administrator", "creator"]);
/** Statuses that mean the bot has lost access and the listing must stop. */
export const REMOVED_STATUSES = new Set(["left", "kicked", "restricted", "member"]);
