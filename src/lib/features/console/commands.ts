// Konsol otomatik tamamlama ve sözdizimi ipucu için Redis komut kataloğu (yaygın ~230 komut).
// Biçim redis.io'daki gibi: `<A | B>` seçimlerden biri zorunlu, `[...]` isteğe bağlı.
// Özetler Redis belgeleriyle aynı dilde (İngilizce) ve kısadır; dile göre çevrilmez.

export type CommandGroup =
  | "generic"
  | "string"
  | "hash"
  | "list"
  | "set"
  | "zset"
  | "stream"
  | "geo"
  | "hll"
  | "bitmap"
  | "pubsub"
  | "transactions"
  | "scripting"
  | "connection"
  | "server"
  | "cluster"
  | "json";

export interface CommandSpec {
  /** Büyük harf; alt komutlar iki kelime ("CONFIG GET") */
  name: string;
  args: string;
  group: CommandGroup;
  summary: string;
  /** Veriyi değiştirir */
  write: boolean;
  /** Onay gerektirebilecek kadar riskli (kesin denetim: danger.ts) */
  dangerous: boolean;
  /** Sık kullanılır: sıralamada öne çıkar */
  common: boolean;
  /** Bağlantıyı akış moduna sokar (SUBSCRIBE, MONITOR) — Pub/Sub sekmesinde çalışır */
  stream: boolean;
  /** Engelleyen komut (BLPOP …) */
  blocking: boolean;
}

// [ad, argümanlar, grup, özet, bayraklar] — bayraklar: w yazma, d tehlikeli, c yaygın, s akış, b engelleyen
type Row = [string, string, CommandGroup, string, string?];

const rows: Row[] = [
  // ── generic ──
  ["DEL", "key [key ...]", "generic", "Delete one or more keys", "wc"],
  ["UNLINK", "key [key ...]", "generic", "Delete keys asynchronously", "w"],
  ["EXISTS", "key [key ...]", "generic", "Count how many of the keys exist", "c"],
  ["EXPIRE", "key seconds [NX | XX | GT | LT]", "generic", "Set a key's time to live in seconds", "wc"],
  ["EXPIREAT", "key unix-time-seconds [NX | XX | GT | LT]", "generic", "Expire a key at a Unix timestamp", "w"],
  ["EXPIRETIME", "key", "generic", "Get the expiration Unix timestamp of a key"],
  ["PEXPIRE", "key milliseconds [NX | XX | GT | LT]", "generic", "Set a key's time to live in milliseconds", "w"],
  ["PEXPIREAT", "key unix-time-milliseconds [NX | XX | GT | LT]", "generic", "Expire a key at a Unix timestamp in ms", "w"],
  ["PEXPIRETIME", "key", "generic", "Get the expiration Unix timestamp in ms"],
  ["PERSIST", "key", "generic", "Remove the expiration from a key", "w"],
  ["TTL", "key", "generic", "Get the time to live of a key in seconds", "c"],
  ["PTTL", "key", "generic", "Get the time to live of a key in milliseconds"],
  ["TYPE", "key", "generic", "Get the type of a key", "c"],
  ["KEYS", "pattern", "generic", "Find all keys matching a pattern (blocks the server)", "c"],
  ["SCAN", "cursor [MATCH pattern] [COUNT count] [TYPE type]", "generic", "Incrementally iterate the keyspace", "c"],
  ["RENAME", "key newkey", "generic", "Rename a key", "w"],
  ["RENAMENX", "key newkey", "generic", "Rename a key only if the new name does not exist", "w"],
  ["RANDOMKEY", "", "generic", "Return a random key"],
  ["DUMP", "key", "generic", "Serialize the value stored at a key"],
  ["RESTORE", "key ttl serialized-value [REPLACE] [ABSTTL] [IDLETIME seconds] [FREQ frequency]", "generic", "Create a key from a serialized value", "w"],
  ["COPY", "source destination [DB destination-db] [REPLACE]", "generic", "Copy a key", "w"],
  ["MOVE", "key db", "generic", "Move a key to another database", "w"],
  ["TOUCH", "key [key ...]", "generic", "Update the last access time of keys"],
  ["SORT", "key [BY pattern] [LIMIT offset count] [GET pattern [GET pattern ...]] [ASC | DESC] [ALPHA] [STORE destination]", "generic", "Sort a list, set or sorted set", "w"],
  ["SORT_RO", "key [BY pattern] [LIMIT offset count] [GET pattern [GET pattern ...]] [ASC | DESC] [ALPHA]", "generic", "Sort (read-only variant)"],
  ["OBJECT ENCODING", "key", "generic", "Get the internal encoding of a value"],
  ["OBJECT FREQ", "key", "generic", "Get the LFU access frequency of a key"],
  ["OBJECT IDLETIME", "key", "generic", "Get seconds since the key was last accessed"],
  ["OBJECT REFCOUNT", "key", "generic", "Get the reference count of a value"],
  ["MEMORY USAGE", "key [SAMPLES count]", "generic", "Estimate the memory used by a key", "c"],
  ["MIGRATE", 'host port <key | ""> destination-db timeout [COPY] [REPLACE] [AUTH password | AUTH2 username password] [KEYS key [key ...]]', "generic", "Atomically move keys to another instance", "w"],
  ["WAIT", "numreplicas timeout", "generic", "Wait for writes to reach replicas", "b"],

  // ── string ──
  ["GET", "key", "string", "Get the value of a key", "c"],
  ["SET", "key value [NX | XX] [GET] [EX seconds | PX milliseconds | EXAT unix-time-seconds | PXAT unix-time-milliseconds | KEEPTTL]", "string", "Set the string value of a key", "wc"],
  ["SETNX", "key value", "string", "Set a key only if it does not exist", "w"],
  ["SETEX", "key seconds value", "string", "Set a key with an expiration in seconds", "w"],
  ["PSETEX", "key milliseconds value", "string", "Set a key with an expiration in milliseconds", "w"],
  ["MGET", "key [key ...]", "string", "Get the values of several keys", "c"],
  ["MSET", "key value [key value ...]", "string", "Set several keys at once", "w"],
  ["MSETNX", "key value [key value ...]", "string", "Set several keys only if none exist", "w"],
  ["GETSET", "key value", "string", "Set a key and return its old value", "w"],
  ["GETDEL", "key", "string", "Get a key's value and delete it", "w"],
  ["GETEX", "key [EX seconds | PX milliseconds | EXAT unix-time-seconds | PXAT unix-time-milliseconds | PERSIST]", "string", "Get a value and change its expiration", "w"],
  ["GETRANGE", "key start end", "string", "Get a substring of a string value"],
  ["SETRANGE", "key offset value", "string", "Overwrite part of a string at an offset", "w"],
  ["APPEND", "key value", "string", "Append a value to a key", "w"],
  ["STRLEN", "key", "string", "Get the length of a string value"],
  ["INCR", "key", "string", "Increment an integer value by one", "wc"],
  ["INCRBY", "key increment", "string", "Increment an integer value", "w"],
  ["INCRBYFLOAT", "key increment", "string", "Increment a floating point value", "w"],
  ["DECR", "key", "string", "Decrement an integer value by one", "w"],
  ["DECRBY", "key decrement", "string", "Decrement an integer value", "w"],
  ["LCS", "key1 key2 [LEN] [IDX] [MINMATCHLEN min-match-len] [WITHMATCHLEN]", "string", "Longest common substring of two strings"],

  // ── hash ──
  ["HGET", "key field", "hash", "Get the value of a hash field", "c"],
  ["HSET", "key field value [field value ...]", "hash", "Set hash fields", "wc"],
  ["HSETNX", "key field value", "hash", "Set a hash field only if it does not exist", "w"],
  ["HMGET", "key field [field ...]", "hash", "Get the values of several hash fields"],
  ["HMSET", "key field value [field value ...]", "hash", "Set several hash fields (deprecated)", "w"],
  ["HGETALL", "key", "hash", "Get all fields and values of a hash", "c"],
  ["HDEL", "key field [field ...]", "hash", "Delete hash fields", "w"],
  ["HEXISTS", "key field", "hash", "Check whether a hash field exists"],
  ["HKEYS", "key", "hash", "Get all field names of a hash"],
  ["HVALS", "key", "hash", "Get all values of a hash"],
  ["HLEN", "key", "hash", "Get the number of fields in a hash"],
  ["HSTRLEN", "key field", "hash", "Get the length of a hash field's value"],
  ["HINCRBY", "key field increment", "hash", "Increment an integer hash field", "w"],
  ["HINCRBYFLOAT", "key field increment", "hash", "Increment a floating point hash field", "w"],
  ["HSCAN", "key cursor [MATCH pattern] [COUNT count] [NOVALUES]", "hash", "Incrementally iterate hash fields"],
  ["HRANDFIELD", "key [count [WITHVALUES]]", "hash", "Return random fields from a hash"],
  ["HEXPIRE", "key seconds [NX | XX | GT | LT] FIELDS numfields field [field ...]", "hash", "Set a time to live on hash fields", "w"],
  ["HTTL", "key FIELDS numfields field [field ...]", "hash", "Get the time to live of hash fields"],
  ["HPERSIST", "key FIELDS numfields field [field ...]", "hash", "Remove the expiration from hash fields", "w"],

  // ── list ──
  ["LPUSH", "key element [element ...]", "list", "Prepend elements to a list", "wc"],
  ["RPUSH", "key element [element ...]", "list", "Append elements to a list", "wc"],
  ["LPUSHX", "key element [element ...]", "list", "Prepend only if the list exists", "w"],
  ["RPUSHX", "key element [element ...]", "list", "Append only if the list exists", "w"],
  ["LPOP", "key [count]", "list", "Remove and return the first elements", "w"],
  ["RPOP", "key [count]", "list", "Remove and return the last elements", "w"],
  ["LRANGE", "key start stop", "list", "Get a range of elements from a list", "c"],
  ["LLEN", "key", "list", "Get the length of a list"],
  ["LINDEX", "key index", "list", "Get an element by its index"],
  ["LSET", "key index element", "list", "Set an element by its index", "w"],
  ["LINSERT", "key <BEFORE | AFTER> pivot element", "list", "Insert an element before or after another", "w"],
  ["LREM", "key count element", "list", "Remove elements from a list", "w"],
  ["LTRIM", "key start stop", "list", "Trim a list to a range", "w"],
  ["LPOS", "key element [RANK rank] [COUNT num-matches] [MAXLEN len]", "list", "Find the index of matching elements"],
  ["LMOVE", "source destination <LEFT | RIGHT> <LEFT | RIGHT>", "list", "Pop from one list and push to another", "w"],
  ["RPOPLPUSH", "source destination", "list", "Pop the last element and push it to another list", "w"],
  ["LMPOP", "numkeys key [key ...] <LEFT | RIGHT> [COUNT count]", "list", "Pop elements from the first non-empty list", "w"],
  ["BLPOP", "key [key ...] timeout", "list", "Blocking pop of the first element", "wb"],
  ["BRPOP", "key [key ...] timeout", "list", "Blocking pop of the last element", "wb"],
  ["BLMOVE", "source destination <LEFT | RIGHT> <LEFT | RIGHT> timeout", "list", "Blocking LMOVE", "wb"],
  ["BLMPOP", "timeout numkeys key [key ...] <LEFT | RIGHT> [COUNT count]", "list", "Blocking LMPOP", "wb"],
  ["BRPOPLPUSH", "source destination timeout", "list", "Blocking RPOPLPUSH", "wb"],

  // ── set ──
  ["SADD", "key member [member ...]", "set", "Add members to a set", "wc"],
  ["SREM", "key member [member ...]", "set", "Remove members from a set", "w"],
  ["SMEMBERS", "key", "set", "Get all members of a set", "c"],
  ["SISMEMBER", "key member", "set", "Check whether a member is in a set"],
  ["SMISMEMBER", "key member [member ...]", "set", "Check membership of several members"],
  ["SCARD", "key", "set", "Get the number of members in a set"],
  ["SPOP", "key [count]", "set", "Remove and return random members", "w"],
  ["SRANDMEMBER", "key [count]", "set", "Get random members of a set"],
  ["SMOVE", "source destination member", "set", "Move a member between sets", "w"],
  ["SINTER", "key [key ...]", "set", "Intersect sets"],
  ["SINTERCARD", "numkeys key [key ...] [LIMIT limit]", "set", "Count the members of a set intersection"],
  ["SINTERSTORE", "destination key [key ...]", "set", "Intersect sets and store the result", "w"],
  ["SUNION", "key [key ...]", "set", "Union of sets"],
  ["SUNIONSTORE", "destination key [key ...]", "set", "Union of sets, stored", "w"],
  ["SDIFF", "key [key ...]", "set", "Difference of sets"],
  ["SDIFFSTORE", "destination key [key ...]", "set", "Difference of sets, stored", "w"],
  ["SSCAN", "key cursor [MATCH pattern] [COUNT count]", "set", "Incrementally iterate set members"],

  // ── sorted set ──
  ["ZADD", "key [NX | XX] [GT | LT] [CH] [INCR] score member [score member ...]", "zset", "Add members to a sorted set", "wc"],
  ["ZREM", "key member [member ...]", "zset", "Remove members from a sorted set", "w"],
  ["ZRANGE", "key start stop [BYSCORE | BYLEX] [REV] [LIMIT offset count] [WITHSCORES]", "zset", "Get a range of members", "c"],
  ["ZRANGEBYSCORE", "key min max [WITHSCORES] [LIMIT offset count]", "zset", "Get members in a score range"],
  ["ZREVRANGE", "key start stop [WITHSCORES]", "zset", "Get a range of members, highest first"],
  ["ZREVRANGEBYSCORE", "key max min [WITHSCORES] [LIMIT offset count]", "zset", "Get members in a score range, highest first"],
  ["ZRANGEBYLEX", "key min max [LIMIT offset count]", "zset", "Get members in a lexicographical range"],
  ["ZRANGESTORE", "dst src min max [BYSCORE | BYLEX] [REV] [LIMIT offset count]", "zset", "Store a range of members", "w"],
  ["ZCARD", "key", "zset", "Get the number of members"],
  ["ZCOUNT", "key min max", "zset", "Count members in a score range"],
  ["ZLEXCOUNT", "key min max", "zset", "Count members in a lexicographical range"],
  ["ZSCORE", "key member", "zset", "Get the score of a member", "c"],
  ["ZMSCORE", "key member [member ...]", "zset", "Get the scores of several members"],
  ["ZRANK", "key member [WITHSCORE]", "zset", "Get the rank of a member"],
  ["ZREVRANK", "key member [WITHSCORE]", "zset", "Get the rank of a member, highest first"],
  ["ZINCRBY", "key increment member", "zset", "Increment the score of a member", "w"],
  ["ZPOPMIN", "key [count]", "zset", "Remove and return the lowest scored members", "w"],
  ["ZPOPMAX", "key [count]", "zset", "Remove and return the highest scored members", "w"],
  ["ZMPOP", "numkeys key [key ...] <MIN | MAX> [COUNT count]", "zset", "Pop members from the first non-empty sorted set", "w"],
  ["BZPOPMIN", "key [key ...] timeout", "zset", "Blocking ZPOPMIN", "wb"],
  ["BZPOPMAX", "key [key ...] timeout", "zset", "Blocking ZPOPMAX", "wb"],
  ["ZREMRANGEBYRANK", "key start stop", "zset", "Remove members in a rank range", "w"],
  ["ZREMRANGEBYSCORE", "key min max", "zset", "Remove members in a score range", "w"],
  ["ZREMRANGEBYLEX", "key min max", "zset", "Remove members in a lexicographical range", "w"],
  ["ZRANDMEMBER", "key [count [WITHSCORES]]", "zset", "Get random members"],
  ["ZUNION", "numkeys key [key ...] [WEIGHTS weight [weight ...]] [AGGREGATE <SUM | MIN | MAX>] [WITHSCORES]", "zset", "Union of sorted sets"],
  ["ZUNIONSTORE", "destination numkeys key [key ...] [WEIGHTS weight [weight ...]] [AGGREGATE <SUM | MIN | MAX>]", "zset", "Union of sorted sets, stored", "w"],
  ["ZINTER", "numkeys key [key ...] [WEIGHTS weight [weight ...]] [AGGREGATE <SUM | MIN | MAX>] [WITHSCORES]", "zset", "Intersection of sorted sets"],
  ["ZINTERSTORE", "destination numkeys key [key ...] [WEIGHTS weight [weight ...]] [AGGREGATE <SUM | MIN | MAX>]", "zset", "Intersection of sorted sets, stored", "w"],
  ["ZINTERCARD", "numkeys key [key ...] [LIMIT limit]", "zset", "Count the members of an intersection"],
  ["ZDIFF", "numkeys key [key ...] [WITHSCORES]", "zset", "Difference of sorted sets"],
  ["ZDIFFSTORE", "destination numkeys key [key ...]", "zset", "Difference of sorted sets, stored", "w"],
  ["ZSCAN", "key cursor [MATCH pattern] [COUNT count]", "zset", "Incrementally iterate members and scores"],

  // ── stream ──
  ["XADD", "key [NOMKSTREAM] [<MAXLEN | MINID> [= | ~] threshold [LIMIT count]] <* | id> field value [field value ...]", "stream", "Append an entry to a stream", "wc"],
  ["XRANGE", "key start end [COUNT count]", "stream", "Get entries in an ID range", "c"],
  ["XREVRANGE", "key end start [COUNT count]", "stream", "Get entries in an ID range, newest first"],
  ["XLEN", "key", "stream", "Get the number of entries"],
  ["XDEL", "key id [id ...]", "stream", "Delete entries", "w"],
  ["XTRIM", "key <MAXLEN | MINID> [= | ~] threshold [LIMIT count]", "stream", "Trim a stream", "w"],
  ["XREAD", "[COUNT count] [BLOCK milliseconds] STREAMS key [key ...] id [id ...]", "stream", "Read entries from streams"],
  ["XREADGROUP", "GROUP group consumer [COUNT count] [BLOCK milliseconds] [NOACK] STREAMS key [key ...] id [id ...]", "stream", "Read entries as a consumer group member", "w"],
  ["XGROUP CREATE", "key group <id | $> [MKSTREAM] [ENTRIESREAD entries-read]", "stream", "Create a consumer group", "w"],
  ["XGROUP DESTROY", "key group", "stream", "Destroy a consumer group", "w"],
  ["XGROUP CREATECONSUMER", "key group consumer", "stream", "Create a consumer in a group", "w"],
  ["XGROUP DELCONSUMER", "key group consumer", "stream", "Delete a consumer from a group", "w"],
  ["XGROUP SETID", "key group <id | $> [ENTRIESREAD entries-read]", "stream", "Set the last delivered ID of a group", "w"],
  ["XACK", "key group id [id ...]", "stream", "Acknowledge processed entries", "w"],
  ["XPENDING", "key group [[IDLE min-idle-time] start end count [consumer]]", "stream", "Inspect pending entries of a group"],
  ["XCLAIM", "key group consumer min-idle-time id [id ...] [IDLE ms] [TIME unix-time-milliseconds] [RETRYCOUNT count] [FORCE] [JUSTID] [LASTID lastid]", "stream", "Change ownership of pending entries", "w"],
  ["XAUTOCLAIM", "key group consumer min-idle-time start [COUNT count] [JUSTID]", "stream", "Claim idle pending entries automatically", "w"],
  ["XINFO STREAM", "key [FULL [COUNT count]]", "stream", "Get information about a stream"],
  ["XINFO GROUPS", "key", "stream", "List the consumer groups of a stream"],
  ["XINFO CONSUMERS", "key group", "stream", "List the consumers of a group"],

  // ── geo ──
  ["GEOADD", "key [NX | XX] [CH] longitude latitude member [longitude latitude member ...]", "geo", "Add geospatial members", "w"],
  ["GEOPOS", "key member [member ...]", "geo", "Get the coordinates of members"],
  ["GEODIST", "key member1 member2 [M | KM | FT | MI]", "geo", "Distance between two members"],
  ["GEOHASH", "key member [member ...]", "geo", "Get Geohash strings of members"],
  ["GEOSEARCH", "key <FROMMEMBER member | FROMLONLAT longitude latitude> <BYRADIUS radius <M | KM | FT | MI> | BYBOX width height <M | KM | FT | MI>> [ASC | DESC] [COUNT count [ANY]] [WITHCOORD] [WITHDIST] [WITHHASH]", "geo", "Query members inside an area"],
  ["GEOSEARCHSTORE", "destination source <FROMMEMBER member | FROMLONLAT longitude latitude> <BYRADIUS radius <M | KM | FT | MI> | BYBOX width height <M | KM | FT | MI>> [ASC | DESC] [COUNT count [ANY]] [STOREDIST]", "geo", "Query an area and store the result", "w"],

  // ── hyperloglog ──
  ["PFADD", "key [element [element ...]]", "hll", "Add elements to a HyperLogLog", "w"],
  ["PFCOUNT", "key [key ...]", "hll", "Approximate cardinality of HyperLogLogs"],
  ["PFMERGE", "destkey [sourcekey [sourcekey ...]]", "hll", "Merge HyperLogLogs", "w"],

  // ── bitmap ──
  ["SETBIT", "key offset value", "bitmap", "Set or clear a bit", "w"],
  ["GETBIT", "key offset", "bitmap", "Get a bit value"],
  ["BITCOUNT", "key [start end [BYTE | BIT]]", "bitmap", "Count set bits"],
  ["BITPOS", "key bit [start [end [BYTE | BIT]]]", "bitmap", "Find the first set or clear bit"],
  ["BITOP", "<AND | OR | XOR | NOT> destkey key [key ...]", "bitmap", "Bitwise operation between strings", "w"],
  ["BITFIELD", "key [GET encoding offset | [OVERFLOW <WRAP | SAT | FAIL>] <SET encoding offset value | INCRBY encoding offset increment> ...]", "bitmap", "Arbitrary bitfield operations", "w"],

  // ── pub/sub ──
  ["PUBLISH", "channel message", "pubsub", "Post a message to a channel", "c"],
  ["SPUBLISH", "shardchannel message", "pubsub", "Post a message to a shard channel"],
  ["SUBSCRIBE", "channel [channel ...]", "pubsub", "Listen for messages on channels", "s"],
  ["PSUBSCRIBE", "pattern [pattern ...]", "pubsub", "Listen for messages on channels matching patterns", "s"],
  ["SSUBSCRIBE", "shardchannel [shardchannel ...]", "pubsub", "Listen for messages on shard channels", "s"],
  ["UNSUBSCRIBE", "[channel [channel ...]]", "pubsub", "Stop listening on channels", "s"],
  ["PUNSUBSCRIBE", "[pattern [pattern ...]]", "pubsub", "Stop listening on patterns", "s"],
  ["PUBSUB CHANNELS", "[pattern]", "pubsub", "List active channels"],
  ["PUBSUB NUMSUB", "[channel [channel ...]]", "pubsub", "Count subscribers of channels"],
  ["PUBSUB NUMPAT", "", "pubsub", "Count pattern subscriptions"],
  ["PUBSUB SHARDCHANNELS", "[pattern]", "pubsub", "List active shard channels"],

  // ── transactions ──
  ["MULTI", "", "transactions", "Start a transaction"],
  ["EXEC", "", "transactions", "Execute queued commands", "w"],
  ["DISCARD", "", "transactions", "Discard queued commands"],
  ["WATCH", "key [key ...]", "transactions", "Watch keys for a transaction"],
  ["UNWATCH", "", "transactions", "Forget watched keys"],

  // ── scripting ──
  ["EVAL", "script numkeys [key [key ...]] [arg [arg ...]]", "scripting", "Run a Lua script", "w"],
  ["EVALSHA", "sha1 numkeys [key [key ...]] [arg [arg ...]]", "scripting", "Run a cached Lua script", "w"],
  ["EVAL_RO", "script numkeys [key [key ...]] [arg [arg ...]]", "scripting", "Run a read-only Lua script"],
  ["EVALSHA_RO", "sha1 numkeys [key [key ...]] [arg [arg ...]]", "scripting", "Run a cached read-only Lua script"],
  ["SCRIPT LOAD", "script", "scripting", "Load a script into the cache"],
  ["SCRIPT EXISTS", "sha1 [sha1 ...]", "scripting", "Check whether scripts are cached"],
  ["SCRIPT FLUSH", "[ASYNC | SYNC]", "scripting", "Remove all scripts from the cache", "d"],
  ["SCRIPT KILL", "", "scripting", "Kill the running script"],
  ["FCALL", "function numkeys [key [key ...]] [arg [arg ...]]", "scripting", "Call a function", "w"],
  ["FCALL_RO", "function numkeys [key [key ...]] [arg [arg ...]]", "scripting", "Call a read-only function"],
  ["FUNCTION LIST", "[LIBRARYNAME library-name-pattern] [WITHCODE]", "scripting", "List libraries and functions"],
  ["FUNCTION LOAD", "[REPLACE] function-code", "scripting", "Load a library", "w"],
  ["FUNCTION DELETE", "library-name", "scripting", "Delete a library", "wd"],
  ["FUNCTION FLUSH", "[ASYNC | SYNC]", "scripting", "Delete all libraries", "wd"],
  ["FUNCTION STATS", "", "scripting", "Information about the running function"],
  ["FUNCTION DUMP", "", "scripting", "Serialize all libraries"],
  ["FUNCTION RESTORE", "serialized-value [FLUSH | APPEND | REPLACE]", "scripting", "Restore libraries from a dump", "w"],

  // ── connection ──
  ["PING", "[message]", "connection", "Test the connection", "c"],
  ["ECHO", "message", "connection", "Return the given string"],
  ["AUTH", "[username] password", "connection", "Authenticate the connection"],
  ["HELLO", "[protover [AUTH username password] [SETNAME clientname]]", "connection", "Handshake and switch protocol"],
  ["SELECT", "index", "connection", "Change the selected database", "c"],
  ["CLIENT LIST", "[TYPE <NORMAL | MASTER | REPLICA | PUBSUB>] [ID client-id [client-id ...]]", "connection", "List client connections", "c"],
  ["CLIENT INFO", "", "connection", "Information about this connection"],
  ["CLIENT ID", "", "connection", "Get this connection's ID"],
  ["CLIENT GETNAME", "", "connection", "Get this connection's name"],
  ["CLIENT SETNAME", "connection-name", "connection", "Set this connection's name"],
  ["CLIENT KILL", "[ip:port] [ID client-id] [TYPE <NORMAL | MASTER | REPLICA | PUBSUB>] [USER username] [ADDR ip:port] [LADDR ip:port] [SKIPME <YES | NO>]", "connection", "Close client connections", "d"],
  ["CLIENT PAUSE", "timeout [WRITE | ALL]", "connection", "Suspend clients", "d"],
  ["CLIENT UNPAUSE", "", "connection", "Resume paused clients"],
  ["CLIENT NO-EVICT", "<ON | OFF>", "connection", "Exempt this connection from eviction"],
  ["RESET", "", "connection", "Reset the connection state"],

  // ── server ──
  ["INFO", "[section [section ...]]", "server", "Information and statistics about the server", "c"],
  ["DBSIZE", "", "server", "Number of keys in the selected database", "c"],
  ["FLUSHDB", "[ASYNC | SYNC]", "server", "Delete all keys of the selected database", "wd"],
  ["FLUSHALL", "[ASYNC | SYNC]", "server", "Delete all keys of all databases", "wd"],
  ["CONFIG GET", "parameter [parameter ...]", "server", "Read configuration parameters", "c"],
  ["CONFIG SET", "parameter value [parameter value ...]", "server", "Change configuration parameters", "d"],
  ["CONFIG RESETSTAT", "", "server", "Reset INFO statistics", "d"],
  ["CONFIG REWRITE", "", "server", "Rewrite the configuration file", "d"],
  ["SLOWLOG GET", "[count]", "server", "Get slow log entries"],
  ["SLOWLOG LEN", "", "server", "Number of slow log entries"],
  ["SLOWLOG RESET", "", "server", "Clear the slow log"],
  ["LATENCY LATEST", "", "server", "Latest latency samples per event"],
  ["LATENCY HISTORY", "event", "server", "Latency history of an event"],
  ["LATENCY DOCTOR", "", "server", "Human-readable latency report"],
  ["LATENCY RESET", "[event [event ...]]", "server", "Reset latency data"],
  ["MEMORY STATS", "", "server", "Memory usage details"],
  ["MEMORY DOCTOR", "", "server", "Memory problem report"],
  ["COMMAND COUNT", "", "server", "Number of commands"],
  ["COMMAND DOCS", "[command-name [command-name ...]]", "server", "Documentary information about commands"],
  ["COMMAND INFO", "[command-name [command-name ...]]", "server", "Information about commands"],
  ["COMMAND LIST", "[FILTERBY <MODULE module-name | ACLCAT category | PATTERN pattern>]", "server", "List command names"],
  ["COMMAND GETKEYS", "command [arg [arg ...]]", "server", "Extract key names from a command"],
  ["TIME", "", "server", "Server time"],
  ["LASTSAVE", "", "server", "Unix time of the last successful save"],
  ["SAVE", "", "server", "Synchronously save to disk (blocks the server)", "d"],
  ["BGSAVE", "[SCHEDULE]", "server", "Save to disk in the background"],
  ["BGREWRITEAOF", "", "server", "Rewrite the append-only file in the background"],
  ["SHUTDOWN", "[NOSAVE | SAVE] [NOW] [FORCE] [ABORT]", "server", "Stop the server", "d"],
  ["DEBUG", "subcommand [argument ...]", "server", "Debugging commands", "d"],
  ["REPLICAOF", "<host port | NO ONE>", "server", "Make the server a replica, or a master", "d"],
  ["SLAVEOF", "<host port | NO ONE>", "server", "Make the server a replica (deprecated)", "d"],
  ["FAILOVER", "[TO host port [FORCE]] [ABORT] [TIMEOUT milliseconds]", "server", "Fail over to a replica", "d"],
  ["ROLE", "", "server", "Replication role of the server"],
  ["MONITOR", "", "server", "Stream every command the server receives", "s"],
  ["SWAPDB", "index1 index2", "server", "Swap two databases", "wd"],
  ["LOLWUT", "[VERSION version]", "server", "Computer art and the Redis version"],
  ["ACL WHOAMI", "", "server", "Current authenticated user"],
  ["ACL LIST", "", "server", "ACL rules in config file format"],
  ["ACL USERS", "", "server", "List ACL users"],
  ["ACL CAT", "[category]", "server", "List ACL categories"],
  ["ACL GETUSER", "username", "server", "Rules of an ACL user"],
  ["ACL SETUSER", "username [rule [rule ...]]", "server", "Create or modify an ACL user"],
  ["ACL DELUSER", "username [username ...]", "server", "Delete ACL users", "d"],
  ["ACL LOG", "[count | RESET]", "server", "Recent ACL security events"],
  ["MODULE LIST", "", "server", "Loaded modules"],
  ["MODULE LOAD", "path [arg [arg ...]]", "server", "Load a module", "d"],
  ["MODULE UNLOAD", "name", "server", "Unload a module", "d"],

  // ── cluster ──
  ["CLUSTER INFO", "", "cluster", "Cluster state information", "c"],
  ["CLUSTER NODES", "", "cluster", "Cluster configuration as seen by the node", "c"],
  ["CLUSTER SHARDS", "", "cluster", "Mapping of shards to nodes"],
  ["CLUSTER SLOTS", "", "cluster", "Mapping of slots to nodes (deprecated)"],
  ["CLUSTER MYID", "", "cluster", "ID of the node"],
  ["CLUSTER KEYSLOT", "key", "cluster", "Hash slot of a key"],
  ["CLUSTER COUNTKEYSINSLOT", "slot", "cluster", "Number of keys in a slot"],
  ["CLUSTER GETKEYSINSLOT", "slot count", "cluster", "Key names in a slot"],
  ["CLUSTER REPLICAS", "node-id", "cluster", "Replicas of a master"],
  ["CLUSTER RESET", "[HARD | SOFT]", "cluster", "Reset the node", "d"],
  ["CLUSTER FAILOVER", "[FORCE | TAKEOVER]", "cluster", "Manual failover of a master", "d"],
  ["CLUSTER FORGET", "node-id", "cluster", "Remove a node from the node table", "d"],
  ["CLUSTER FLUSHSLOTS", "", "cluster", "Delete the node's own slots", "d"],
  ["CLUSTER DELSLOTS", "slot [slot ...]", "cluster", "Unassign slots", "d"],
  ["CLUSTER SETSLOT", "slot <IMPORTING node-id | MIGRATING node-id | NODE node-id | STABLE>", "cluster", "Bind a slot to a node", "d"],
  ["CLUSTER MEET", "ip port", "cluster", "Join another node to the cluster", "d"],
  ["CLUSTER REPLICATE", "node-id", "cluster", "Make the node a replica of a master", "d"],
  ["READONLY", "", "cluster", "Allow reads from replica nodes"],
  ["READWRITE", "", "cluster", "Disable reads from replica nodes"],

  // ── JSON (RedisJSON) ──
  ["JSON.GET", "key [INDENT indent] [NEWLINE newline] [SPACE space] [path [path ...]]", "json", "Get JSON values at paths"],
  ["JSON.SET", "key path value [NX | XX]", "json", "Set a JSON value at a path", "w"],
  ["JSON.DEL", "key [path]", "json", "Delete a JSON value", "w"],
  ["JSON.TYPE", "key [path]", "json", "Type of a JSON value"],
  ["JSON.MGET", "key [key ...] path", "json", "Get a path from several keys"],
  ["JSON.ARRAPPEND", "key path value [value ...]", "json", "Append to a JSON array", "w"],
  ["JSON.NUMINCRBY", "key path value", "json", "Increment a JSON number", "w"],
  ["JSON.OBJKEYS", "key [path]", "json", "Keys of a JSON object"],
];

export const COMMANDS: readonly CommandSpec[] = rows.map(([name, args, group, summary, flags = ""]) => ({
  name,
  args,
  group,
  summary,
  write: flags.includes("w"),
  dangerous: flags.includes("d"),
  common: flags.includes("c"),
  stream: flags.includes("s"),
  blocking: flags.includes("b"),
}));

const byName = new Map(COMMANDS.map((c) => [c.name, c]));

/** "CONFIG", "CLIENT" gibi alt komut taşıyan adlar */
export const CONTAINERS: ReadonlySet<string> = new Set(COMMANDS.filter((c) => c.name.includes(" ")).map((c) => c.name.split(" ")[0]));

export function findCommand(name: string): CommandSpec | undefined {
  return byName.get(name.toUpperCase());
}

/** Tokenlerin başındaki komutu bulur (önce iki kelimelik alt komut). `words` kaç token tükettiği. */
export function lookupCommand(tokens: readonly string[]): { spec: CommandSpec; words: number } | null {
  if (tokens.length === 0) return null;
  const first = tokens[0].toUpperCase();
  if (tokens.length > 1 && CONTAINERS.has(first)) {
    const spec = byName.get(`${first} ${tokens[1].toUpperCase()}`);
    if (spec) return { spec, words: 2 };
  }
  const spec = byName.get(first);
  return spec ? { spec, words: 1 } : null;
}
