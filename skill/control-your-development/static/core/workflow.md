# 主流程（workflow）

> 每次被调用后的默认路径。场景细节在 fragments/mode/ 下，只加载匹配的一篇。

1. **判定场景**（init / update / decide / verify），向用户声明一行归类，继续执行——不是审批门。
2. **定位两个目录**：目标项目根下的 `dev-dashboard/`（没有就是 init 场景）；本 skill 目录（通过 skill 工具的 resourceBase 获知，脚本在其中 scripts/ 下）。
3. **按场景 fragment 执行**（init / update / decide / verify 各一篇）。
4. **每次结束必须渲染**：运行 `<Python解释器> <skill目录>/scripts/render_dashboard.py dev-dashboard/`，退出码 2（BLOCKER）当场修到 0。
   - `<Python解释器>` 换成 DSH 自带 python.exe 的完整路径（Windows 上光写 `python` 可能落到系统 Python），`<skill目录>` 是本 skill 的安装目录；两处都要替换，不要原样照抄。
   - dev-dashboard 不在项目根、或 monorepo 子目录时补 `--workspace <工作区根>`（见 references/dashboard-format.md）。
5. **一句话收尾**：告诉用户这次更新了什么、有没有等他拍板的事、双击哪个文件查看。
