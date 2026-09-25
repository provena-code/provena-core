# provena-core
Provena is system designed to allow students to show their work on programming problems, and to enable instructors to verify student effort. It works by collecting detailed but narrowly-scoped log data as students work, calcualting the provenance of student code, visualizing their code histories, and reporting metrics that can help flag suspicious behavior for further inspection. The primary goal of Provena is to encourage practice and deter help that skips the learning process (see Premise below).

The whole Provena system consistnes of:
* This repository, which contains the core logic for calculating code provenance and other useful features from edit histories (e.g. in [ProgSnap2 format](https://cssplice.org/progsnap2/). This is a library used in other applications.
* [provena-vscode](https://github.com/thomaswp/provena-vscode) extension: A VS Code plugin for collecting log data used to ensure students.
* [provena-server](https://github.com/thomaswp/provena-client): A server for collecting log data and serving it to the instructor.
* [provena-client](https://github.com/thomaswp/provena-client): An instructor-facing dashboard for viewing student work.

## Premise
**The Problem**: Repeated studies show that out-of-class practice is a key driver of learning (the "doer effect"). However, in a world where GenAI can solve homework problems instantly, many students question why they should bother putting in the effort when they know their peers may not be. Equally concerning, students increasingly fear and report false accusations of cheating with AI by their instructors. GenAI is undermining the ability of instructors to assign needed out-of-class practice to students, demotivating students, and creating persistent uncertainty around academic integrity.

**The Solution**: Provena is a system that addresses these challenges, such that:
* Students feel confident that their work counts for something, and that they won't be falsely accused of cheating.
* Instructors can assign graded practice and have confidence that students' work is their own.
* Instructors can create assignments that permit students to use GenAI in specific ways (e.g. line completion is ok, full solutions are not) and assess whether students followed instructions.

As an added bonus, Provena also collects data that can advance research by collecting a high-quality, keystroke-level dataset, helping us understand how students make use of external resources and AI tools. (By default, data is only collected for the instructor; research requires ethics board approval and student consent, but students are much more likely to consent to data collection if it has a class purpose.)

## Provena Setup
To setup the whole Provena system, you will need to set up the other 3 repositories linked above according to their own instructions. Two of them will include this repository as a submodule.

If you want to develop, improve or test this submodule by itself:
* Install dependencies: [Node.js](https://nodejs.org/) and npm.
* Run `npm install`

## Tests
This project uses vitest to run tests. You can use the official VS Code Vitest extension to run them easily, or use: `npm run test`.

**Note**: Some tests concern runtime and if you run all tests in parallel, as is the default for vitest, they may fail. Run the individually instead.

## Citing Provena

To cite Provena, please cite:

Price, T.W., Titus, K., Jiao, S. & and Tran, K. (2026, November). "Beyond Copy-Paste: Detecting and Understanding Students’ Use of Unauthorized Aid when Monitored." In Proceedings of the 26th Koli Calling International Conference on Computing Education Research (pp. 1-12).


```
@inproceedings{price2026beyond,
  title={Beyond Copy-Paste: Detecting and Understanding Students’ Use of Unauthorized Aid when Monitored},
  author={Price, Thomas W. and Titus, Kim and Jiao, Shuyin and Tran, Keith},
  booktitle={Proceedings of the 26th Koli Calling International Conference on Computing Education Research},
  pages={1--12},
  year={2026}
}
```