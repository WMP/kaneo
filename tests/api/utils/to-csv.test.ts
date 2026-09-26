import { describe, expect, it } from "vitest";
import { toCsv } from "../../../apps/api/src/utils/to-csv";

describe("toCsv", () => {
  it("writes a UTF-8 BOM, a header row, and one row per record", () => {
    const csv = toCsv(
      [
        { id: "1", name: "Ada" },
        { id: "2", name: "Grace" },
      ],
      ["id", "name"],
    );

    expect(csv).toBe("﻿id,name\r\n1,Ada\r\n2,Grace\r\n");
  });

  it("quotes fields containing a comma, quote, or newline, doubling internal quotes", () => {
    const csv = toCsv(
      [{ id: "1", note: 'Has a comma, a "quote", and\na newline' }],
      ["id", "note"],
    );

    expect(csv).toBe(
      '﻿id,note\r\n1,"Has a comma, a ""quote"", and\na newline"\r\n',
    );
  });

  it("renders null and undefined as empty cells", () => {
    const csv = toCsv(
      [{ id: "1", value: null, other: undefined }],
      ["id", "value", "other"],
    );

    expect(csv).toBe("﻿id,value,other\r\n1,,\r\n");
  });

  it("serializes Date values as ISO strings", () => {
    const csv = toCsv(
      [{ id: "1", createdAt: new Date("2024-01-01T00:00:00.000Z") }],
      ["id", "createdAt"],
    );

    expect(csv).toBe("﻿id,createdAt\r\n1,2024-01-01T00:00:00.000Z\r\n");
  });

  it("JSON-stringifies plain object values, e.g. eventData payloads", () => {
    const csv = toCsv(
      [{ id: "1", eventData: { oldStatus: "to-do", newStatus: "done" } }],
      ["id", "eventData"],
    );

    expect(csv).toBe(
      '﻿id,eventData\r\n1,"{""oldStatus"":""to-do"",""newStatus"":""done""}"\r\n',
    );
  });
});
