// ui.js：操作面板与视图（原生 DOM，无弹窗）
import { render } from "./app.js";

export function mount(spec, parts) {
  parts.log.textContent = "事件 " + (spec.events || []).length + " 条，副本 " + (spec.reps || 0) + " 个，本轮修复预算 " + (spec.budget || 0) + " 条。";

  function draw() {
    let view = null;
    try {
      view = render(spec);
    } catch (error) {
      parts.out.textContent = String(error && error.code ? error.code : error);
      parts.log.textContent = "跑不动：" + String(error && error.message ? error.message : error);
      return;
    }
    parts.out.textContent = JSON.stringify(view, null, 1);
    parts.stage.textContent = "";
    (view.versions || []).forEach(function (row) {
      const line = document.createElement("div");
      line.className = "row";
      const head = document.createElement("span");
      head.textContent = row[0] + " 副本 " + row.slice(1).join(" / ");
      line.appendChild(head);
      const mark = document.createElement("span");
      const same = row.slice(1).every(function (value) { return value === row[1]; });
      mark.className = "chip" + (same ? " ok" : " warn");
      mark.textContent = same ? "一致" : "还差副本";
      line.appendChild(mark);
      parts.stage.appendChild(line);
    });
    (view.pending_ids || []).forEach(function (id) {
      const row = document.createElement("div");
      row.className = "row";
      const head = document.createElement("span");
      head.textContent = "修复请求 " + id + " 压在账上";
      row.appendChild(head);
      const chip = document.createElement("span");
      chip.className = "chip warn";
      chip.textContent = "等收尾";
      row.appendChild(chip);
      parts.stage.appendChild(row);
    });
    parts.legend.textContent = "读结果 " + JSON.stringify(view.reads) + "，首轮修复 "
      + view.healed_first + " 条，二档 " + view.healed_wide + " 条，收尾前待修复 "
      + view.pending + " 条，收尾补齐 " + view.catchup + " 条，收尾后待修复 " + view.pending_after + " 条";
    parts.log.textContent = "工作计数 " + view.judged + " / 上界 " + view.judged_bound
      + "，重放新增修复 " + view.replay + "，与全量对照差异 " + view.full_diff;
  }

  const budgetInput = document.createElement("input");
  budgetInput.type = "number";
  budgetInput.value = "1";
  parts.controls.appendChild(budgetInput);

  const runButton = document.createElement("button");
  runButton.className = "primary";
  runButton.textContent = "跑一遍";
  runButton.addEventListener("click", draw);
  parts.controls.appendChild(runButton);

  const budgetButton = document.createElement("button");
  budgetButton.textContent = "把修复预算换成输入框的值";
  budgetButton.addEventListener("click", function () {
    const next = Number(budgetInput.value);
    spec.budget = Number.isFinite(next) ? Math.max(1, Math.round(next)) : 1;
    draw();
  });
  parts.controls.appendChild(budgetButton);

  const dropButton = document.createElement("button");
  dropButton.textContent = "删最后一条事件";
  dropButton.addEventListener("click", function () {
    spec.events = (spec.events || []).slice(0, Math.max(0, (spec.events || []).length - 1));
    draw();
  });
  parts.controls.appendChild(dropButton);

  draw();
}
