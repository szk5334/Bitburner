const allowAscension = true;

	let GANGSTER_NAMES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

/** @param {NS} ns **/
export async function main(ns) {
	ns.disableLog('ALL');


	if (!ns.gang.inGang()) {
		ns.tprint('ERROR: Not in a gang, exiting');
		ns.print('ERROR: Not in a gang, exiting');
		return;
	}

	let otherGangsInfoPrevCycle = undefined;
	let nextTick = undefined;
	let gangInfo = ns.gang.getGangInformation();
	let members = ns.gang.getMemberNames();

	AssignTasks(ns, members, gangInfo);

	while (true) {

		gangInfo = ns.gang.getGangInformation();

		// *** Recruitment ***
		await RecruitMembers(ns);

		// *** Get current gang member names and gangInfo ***
		members = ns.gang.getMemberNames();
		gangInfo = ns.gang.getGangInformation();

		// *** Automatic ascension ***
		// We prevent ascension if at the current rate we expect to get our next member soon
		const nextMemberTime = GetNextMemberTime(ns, members, gangInfo);
		const timeLock = Math.pow(2, (members.length + 1) * 0.7) * 1000;
		//ns.tprint('TimeLock: ' + ns.tFormat(timeLock));

		if (nextMemberTime != -1 || members.length == 12) {
			if (members.length < 12 && nextMemberTime < timeLock) {
				//ns.print('WARN: Ascension LOCKED, next: ' + ns.tFormat(nextMemberTime) + ' lock threshold: ' + ns.tFormat(timeLock));
			}
			else {
				//ns.print('INFO: Checking ascension, next: ' + ns.tFormat(nextMemberTime) + ' lock threshold: ' + ns.tFormat(timeLock));
				if (allowAscension) {
					for (let i = 0; i < members.length; i++) {
						const member = members[i];
						AscendGangMember(ns, member);
					}
				}
			}
		}

		// *** Territory warfaire ***
		// Detect new tick
		let otherGangsInfo = ns.gang.getOtherGangInformation();
		let newTick = false;
		for (let i = 0; i < Object.keys(otherGangsInfo).length; i++) {
			const gangName = Object.keys(otherGangsInfo)[i];
			if (gangName == gangInfo.faction) continue;

			let gi = Object.values(otherGangsInfo)[i];
			let ogi = otherGangsInfoPrevCycle ? Object.values(otherGangsInfoPrevCycle)[i] : gi;

			let powerChanged = gi.power != ogi.power;
			let territoryChanged = gi.territory != ogi.territory;
			let changed = powerChanged || territoryChanged;

			if (changed) {
				newTick = true;
			}
		}

		// If we're in a new tick, take note of when next one is going to happen
		if (newTick) {
			//ns.print('WARN: -- NEW TICK DETECTED --');
			if (nextTick != undefined) {
				AssignTasks(ns, members, gangInfo);
			}
			nextTick = Date.now() + 19000;
		}

		// Update our cache of otherGangsInfo
		otherGangsInfoPrevCycle = otherGangsInfo;

		if (gangInfo.territory < 1) {
			// Assign members to territory warfare
			if (nextTick != undefined && Date.now() + 500 > nextTick) {
				//ns.print('WARN: Assigning all members to territory warfare');
				for (let member of members)
					ns.gang.setMemberTask(member, 'Territory Warfare');
			}
		}
		else {
			//ns.print('INFO: Skipping territory warfare, we are at 100% territory! Focusing on $$$');
		}

		ns.gang.setTerritoryWarfare(
			['Speakers for the Dead','Tetrads','The Syndicate','The Dark Army','NiteSec','The Black Hand', 'Slum Snakes']
			.map(faction => ns.gang.getChanceToWinClash(faction))
			.map(pct => {if(pct === undefined){return 100}else{return pct}})
			.filter(pct => pct < 0.55)
			.length == 0 
			&& gangInfo.territory < 1);

		await ns.sleep(1000);
	}
}

function GetNextMemberTime(ns, members, gangInfo) {
	if (members.length == 12) return -1;

	// Check how much reputation we need to recruit the next member
	const needed = getRespectNeededToRecruitMember(ns, members);
	//ns.print('Needed: ' + needed);
	if (needed == 0) return -1;

	// Check how much we currently have
	const current = gangInfo.respect;
	//ns.print('Current: ' + current);
	if (current > needed) return -1;

	// Evaluate our current gain rate
	let gainPerMs = 0;
	try {
		gainPerMs = gangInfo.respectGainRate / 200;
	}
	catch {
		gainPerMs = 0;
	}
	//ns.print('Gain: ' + gainPerMs);
	if (gainPerMs <= 0) return 0;

	// evaluate how long it will take to get our next member at the current rate
	const time = (needed - current) / gainPerMs;
	//ns.print('Time: ' + time);
	return time;
}

// Ripped/adapted from source code
// https://github.com/danielyxie/bitburner/blob/2592c6ccd89d5559c9cc3cdf99416eb1c57edca2/src/Gang/Gang.ts#L296-L303
function getRespectNeededToRecruitMember(ns, members) {
	// First N gang members are free (can be recruited at 0 respect)
	const numFreeMembers = 3;
	if (members.length < numFreeMembers) return 0;

	const i = members.length - (numFreeMembers - 1);
	return Math.pow(5, i);
}

function AssignTasks(ns, members, gangInfo) {
	//ns.print('WARN: Assigning best tasks');

	// This is used to store the respect/wanted offset
	// If the first few members are generating mad respect, it can offset lower gang members
	// being really bad...
	let carryOver = 0;

	let sortedMembers = [...members].sort((a, b) => MemberWeight(ns, b) - MemberWeight(ns, a));

	for (let i = 0; i < sortedMembers.length; i++) {
		let member = sortedMembers[i];
		let focusMoney = (i < sortedMembers.length / 2) //|| ns.singularity.getFactionRep('Slum Snakes') >= 1_875_000;
		//(i < sortedMembers.length / 2) || ns.gang.getGangInformation().territory == 1
		let [newTask, carry] = FindBestTask(ns, gangInfo, member, focusMoney, carryOver);
		carryOver = carry;
		ns.gang.setMemberTask(member, newTask);
		//ns.print('WARN: Assigning task ' + newTask + ' to ' + member + ' forMoney: ' + focusMoney);
	}
}

function MemberWeight(ns, member) {
	let stats = ns.gang.getMemberInformation(member);
	let weight = stats.str + stats.def + stats.dex + stats.agi + stats['ha' + 'ck'] + stats.cha;
	return weight;
}

function GetNames(ns) {
	let names = new Set(ns.gang.getMemberNames());
	while ([...names].length < 12) {
		let index = Math.floor(Math.random() * GANGSTER_NAMES.length);
		let name = GANGSTER_NAMES[index];
		names.add(name);
	}
	return [...names];
}

async function RecruitMembers(ns) {
	let members = GetNames(ns);

	while (ns.gang.canRecruitMember()) {
		//ns.print('INFO: We can currently recruit a new member!');
		let newMember = members.pop();
		ns.gang.recruitMember(newMember);
		ns.print('SUCCESS: Recruited a new gang member called ' + newMember);
		// new members go straight to respect tasks
		let [newTask, carry] = FindBestTask(ns, ns.gang.getGangInformation(), newMember, false, 0);
		ns.gang.setMemberTask(newMember, newTask);
		await ns.sleep(10);
	}
}

function AscendGangMember(ns, member) {
	const ascensionResult = ns.gang.getAscensionResult(member);
	if (ascensionResult == undefined) return;
	let threshold = CalculateAscendTreshold(ns, member);
	if (ascensionResult.agi >= threshold || ascensionResult.str >= threshold || ascensionResult.def >= threshold || ascensionResult.dex >= threshold) {
		const respect = Math.max(1, ns.gang.getMemberInformation(member).respect);
		const gangRespect = Math.max(12, ns.gang.getGangInformation().respect);
		const respectRatio = respect / gangRespect;
		if (respectRatio > 1 / 12) {
			ns.print('FAIL: Holding ascension of ' + member);
			return; // Prevent ascending anyone whose respect is over X% of the gang's respect
		}

		ns.gang.ascendMember(member);
		ns.print('WARN: Ascending ' + member);
	}
}

// Credit: Mysteyes. https://discord.com/channels/415207508303544321/415207923506216971/940379724214075442
function CalculateAscendTreshold(ns, member) {
	let mult = ns.gang.getMemberInformation(member)['str_asc_mult'];
	if (mult < 1.632) return 1.6326;
	if (mult < 2.336) return 1.4315;
	if (mult < 2.999) return 1.284;
	if (mult < 3.363) return 1.2125;
	if (mult < 4.253) return 1.1698;
	if (mult < 4.860) return 1.1428;
	if (mult < 5.455) return 1.1225;
	if (mult < 5.977) return 1.0957;
	if (mult < 6.496) return 1.0869;
	if (mult < 7.008) return 1.0789;
	if (mult < 7.519) return 1.073;
	if (mult < 8.025) return 1.0673;
	if (mult < 8.513) return 1.0631;
	return 1.0591;
}

function FindBestTask(ns, gangInfo, member, prioritizeMoney, carryOver) {
	// Absolute priority, if we got wanted penalty goes too far we fix that shit, it cripples everything
	// if (gangInfo.wantedPenalty < 0.80 && gangInfo.wantedLevel > 1 && gangInfo.respect > 1) {
	// 	return ['Vigilante Justice', carryOver];
	// }

	let mi = ns.gang.getMemberInformation(member);

	// Force training on combat stats
	// if (mi.str < 100) {
	// 	return ['Train Combat', carryOver];
	// }

	let ALLOWED_TASKS = [
		'Mug People',
		'Deal Drugs',
		'Strongarm Civilians',
		'Run a Con',
		'Armed Robbery',
		'Traffick Illegal Arms',
		'Threaten & Blackmail',
		'Human Trafficking'
	];

	//ns.print(ALLOWED_TASKS);

	// For respect, terrorism is king, no reason to waste time with other
	// tasks. If money is a concern, it would be best to split members
	// between money/respect focus instead of doing half-assed tasks
	// See where this function is called.
	if (!prioritizeMoney) ALLOWED_TASKS = ['Terrorism'];

	// Evaluate the gains of allowed tasks
	let tasks = [];
	for (let task of ALLOWED_TASKS) {
		let stats = ns.gang.getTaskStats(task);
		let money = ns.formulas.gang.moneyGain(gangInfo, mi, stats);
		let respect = ns.formulas.gang.respectGain(gangInfo, mi, stats);
		let wanted = ns.formulas.gang.wantedLevelGain(gangInfo, mi, stats);

		let wantedPen = wanted == 0 ? 0 : respect / (respect + wanted);


		// Skip tasks that increase our wanted level (we'll likely default to combat training)
		//if (!prioritizeMoney && respect + carryOver < wanted) continue;
		//if (!prioritizeMoney) carryOver += respect / wanted;

		// Skip tasks that do not generate respect if we're focused on respect
		if (!prioritizeMoney && respect <= 0) continue;

		// Skip tasks that do not generate money if we're focused on money
		if (prioritizeMoney && money <= 0) continue;

		if (wanted > respect / 2) continue;

		// Add the task to our todo list, we'll sort and pick the best one later
		tasks.push({
			task: task,
			money: money,
			wanted: wanted,
			respect: respect,
			carryOver: carryOver
		});
	}

	// If we have more than one task, sort it based on our focus
	if (tasks.length > 1) {
		let sortKey = prioritizeMoney ? 'money' : 'respect';
		tasks.sort((a, b) => b[sortKey] - a[sortKey]);
	}

	// If we have no tasks, it means none of them correspond to our focus without generating wanted penalty
	// We train combat until that changes
	if (tasks.length == 0) {
		tasks.push({
			task: 'Train Combat',
			money: 0,
			wanted: 0,
			respect: 0,
			carryOver: carryOver
		});
	}

	// Return the fist task in the list
	return [tasks[0].task, tasks[0].carryOver];
}

export async function TryRunScript(ns, script, params = []) {
	const pids = ns.run(script, 1, ...params);
	await WaitPids(ns, pids);
	if (pids.length == 0) {
		ns.tprint('WARN: Not enough ram to run ' + script);
	}
	else
		ns.print('INFO: Started ' + script + ' with params [' + params + ']');
}
