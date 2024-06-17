# worker-timers-cdn

This repository was created to use [worker-timers](https://github.com/chrisguttandin/worker-timers) module not as a module but as a regular script. Meaning, no webpack, rollup, grunt, and whatever else is out there - at least at your end.
---
### What you need to make this work?
Simply download [WorkerTimers.js](https://raw.githubusercontent.com/PLTytus/worker-timers-cdn/master/WorkerTimers.js) and add it to your project.
```html
<script type="text/javascript" src="WorkerTimers.js"></script>
```
You can even skip the downloading part (not recommended) and use URL to the raw file in this repostiory.
```html
<script type="text/javascript" src="https://raw.githubusercontent.com/PLTytus/worker-timers-cdn/master/WorkerTimers.js"></script>
```
---
### Usage:
```js
let intreval = WorkerTimers.setInterval(...)
WorkerTimers.clearInterval(interval);
let timeout = WorkerTimers.setTimeout(...)
WorkerTimers.clearTimeout(timeout);
```
Or overwrite the native functions:
```js
window.setInterval = WorkerTimers.setInterval;
window.clearInterval = WorkerTimers.clearInterval;
window.setTimeout = WorkerTimers.setTimeout;
window.clearTimeout = WorkerTimers.clearTimeout;

let intreval = setInterval(...)
clearInterval(interval);
let timeout = setTimeout(...)
clearTimeout(timeout);
```
Or if you prefer to keep native functions intact:
```js
window.setInterval2 = WorkerTimers.setInterval;
window.clearInterval2 = WorkerTimers.clearInterval;
window.setTimeout2 = WorkerTimers.setTimeout;
window.clearTimeout2 = WorkerTimers.clearTimeout;

let intreval = setInterval2(...)
clearInterval2(interval);
let timeout = setTimeout2(...)
clearTimeout2(timeout);
```
Of course, you can choose your own functions names, it's your code :-)