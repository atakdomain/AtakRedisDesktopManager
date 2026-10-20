import { describe, expect, it } from "vitest";
import { isSensitive, pushHistory, searchHistory, stepHistory } from "./history";

describe("pushHistory", () => {
  it("tekrarları sona taşır ve sınırı korur", () => {
    expect(pushHistory(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]);
    expect(pushHistory(["a", "b"], "  ")).toEqual(["a", "b"]);
    expect(pushHistory(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"]);
  });
});

describe("isSensitive", () => {
  it("parola içeren komutlar", () => {
    expect(isSensitive("AUTH secret")).toBe(true);
    expect(isSensitive("auth user pass")).toBe(true);
    expect(isSensitive("HELLO 3 AUTH u p")).toBe(true);
    expect(isSensitive("ACL SETUSER bob >pw on")).toBe(true);
    expect(isSensitive("CONFIG SET requirepass x")).toBe(true);
    expect(isSensitive("CONFIG SET maxmemory 1gb")).toBe(false);
    expect(isSensitive("GET auth")).toBe(false);
  });
});

describe("stepHistory", () => {
  const list = ["get a", "set b 1", "get c", "hgetall h"];

  it("öneksiz: yeniden eskiye, taslağa dönüş", () => {
    let s = stepHistory(list, "", -1, 1);
    expect(s).toEqual({ index: 0, value: "hgetall h" });
    s = stepHistory(list, "", 0, 1);
    expect(s?.value).toBe("get c");
    expect(stepHistory(list, "", 3, 1)).toBeNull();
    expect(stepHistory(list, "", 0, -1)).toEqual({ index: -1, value: "" });
    expect(stepHistory(list, "", -1, -1)).toBeNull();
  });

  it("önek süzgeci", () => {
    expect(stepHistory(list, "GET", -1, 1)?.value).toBe("get c");
    expect(stepHistory(list, "GET", 0, 1)?.value).toBe("get a");
    expect(stepHistory(list, "GET", 1, 1)).toBeNull();
    expect(stepHistory(list, "GET", 0, -1)).toEqual({ index: -1, value: "GET" });
  });
});

describe("searchHistory", () => {
  it("içeren kayıtlar, en yeni önce", () => {
    expect(searchHistory(["get a", "set b", "get c"], "GET")).toEqual(["get c", "get a"]);
  });
});
