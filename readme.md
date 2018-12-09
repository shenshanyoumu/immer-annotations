## 什么是 immer

&nbsp;&nbsp;“immer”在德文中表示“always”，是一款轻量级的不可变状态修改库，其基于“写时拷贝”的机制实现。该库由 Mobx 作者开发，是更底层的 Mobx，将 Mobx 特性发扬光大，得以结合到任何数据流框架，使用起来非常优雅。

## immer 核心思想

&nbsp;&nbsp;其核心思想就是利用 ES6 的 proxy 特性或者 ES5 的 defineProperty 函数，将对象的所有修改先保存在一个临时的 draftState 对象，这是 currentState 的代理对象。当所有修改动作结束，immer 将会根据 draftState 状态对象来生成 nextState 对象输出。
![immer-hd.png](assets/immer.png)

&nbsp;&nbsp;draft 的思想其实与 immutable 库中 withMutations 方法类似，都是先将 currentState 的修改临时存储，然后在统一修改生成 nextState，其主要目的一方面是提高状态修改性能，因为减少对象属性访问可以有效提高性能；另一方面是为了拦截一些修改行为

## immer 特点

（1）支持柯里化  
&nbsp;&nbsp;immer.js 是一个支持柯里化的同步计算的工具，非常适合 redux 的 reducer 使用。

（2）原生实现 immutable  
&nbsp;&nbsp;immer.js 利用 ES6 的对象代理 proxy/或者 ES5 的 defineProperty 方法来实现原生数据结构的 immutable；

（3）基于 Proxy 特性，不需要开发者学习新 API

（4）库非常小，压缩后只有 2K
