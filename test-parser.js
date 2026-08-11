const assert = require("node:assert/strict");
const { parseQuestionNote } = require("./parser");

const note = `# KAOJJ 错题清洗版

## 题目一
ACP 的核心目标是什么？
A. 选项一
B. 选项二
C. 选项三
D. 选项四
答案：B
解析：第一题解析

---

2、下面哪项正确？
1. 数字选项一
2. 数字选项二
3. 数字选项三
答案：2
`;

const questions = parseQuestionNote(note);
assert.equal(questions.length, 2);
assert.equal(questions[0].correctAnswers[0], "B");
assert.equal(questions[1].correctAnswers[0], "B");

const marked = parseQuestionNote(`多选题\nA. 甲 ✅\nB. 乙\nC. 丙 ✅`);
assert.deepEqual(marked[0].correctAnswers, ["A", "C"]);

const cleanedNote = parseQuestionNote(`---
source: KAOJJ
---
## 错题 1/2

### 题干
以下哪项正确？

### 选项
- A. 选项一
- B. 选项二

### 答案
- 正确答案：A. 选项一
- 我的答案：B. 选项二

### 解析
这是解析。

## 错题 2/2

### 题干
以下哪些正确？

### 选项
- A. 选项一
- B. 选项二
- C. 选项三

### 答案
- 正确答案：A、C
`);
assert.equal(cleanedNote.length, 2);
assert.deepEqual(cleanedNote[0].correctAnswers, ["A"]);
assert.deepEqual(cleanedNote[1].correctAnswers, ["A", "C"]);

console.log(`static parser tests passed (${questions.length + marked.length} questions)`);
