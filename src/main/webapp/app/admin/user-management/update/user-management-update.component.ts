import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { User } from 'app/account/user/user.model';
import { JhiLanguageHelper } from 'app/core/language/shared/language.helper';
import { ArtemisNavigationUtilService } from 'app/foundation/util/navigation.utils';
import { OrganizationManagementService } from 'app/admin/organization-management/organization-management.service';
import { OrganizationSelectorComponent } from 'app/admin/organization-selector/organization-selector.component';
import { Organization } from 'app/admin/organization-management/organization.model';
import {
    TumUiButtonComponent,
    TumUiButtonDirective,
    TumUiCheckboxComponent,
    TumUiChipComponent,
    TumUiDialogComponent,
    TumUiInputDirective,
    TumUiSelectComponent,
    TumUiTooltipDirective,
} from '@tumaet/ui-angular';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PROFILE_JENKINS, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from 'app/app.constants';
import { faBan, faSave } from '@fortawesome/free-solid-svg-icons';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertService, AlertType } from 'app/foundation/service/alert.service';
import { ProfileService } from 'app/core/layouts/profiles/shared/profile.service';
import { AdminUserService } from 'app/account/user/shared/admin-user.service';
import { TranslateDirective } from 'app/foundation/language/translate.directive';
import { HelpIconComponent } from 'app/shared-ui/components/help-icon/help-icon.component';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { FindLanguageFromKeyPipe } from 'app/foundation/language/find-language-from-key.pipe';
import { ArtemisTranslatePipe } from 'app/foundation/pipes/artemis-translate.pipe';
import { AdminTitleBarTitleDirective } from 'app/admin/shared/admin-title-bar-title.directive';
import { AccountService } from 'app/core/auth/account.service';
import { Authority } from 'app/foundation/constants/authority.constants';

@Component({
    selector: 'jhi-user-management-update',
    templateUrl: './user-management-update.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
        FormsModule,
        ReactiveFormsModule,
        TranslateDirective,
        TumUiTooltipDirective,
        HelpIconComponent,
        TumUiInputDirective,
        TumUiCheckboxComponent,
        TumUiSelectComponent,
        TumUiChipComponent,
        TumUiButtonComponent,
        TumUiButtonDirective,
        TumUiDialogComponent,
        OrganizationSelectorComponent,
        FaIconComponent,
        ArtemisTranslatePipe,
        AdminTitleBarTitleDirective,
    ],
})
export class UserManagementUpdateComponent implements OnInit {
    private readonly languageHelper = inject(JhiLanguageHelper);
    private readonly userService = inject(AdminUserService);
    private readonly route = inject(ActivatedRoute);
    private readonly organizationService = inject(OrganizationManagementService);
    private readonly navigationUtilService = inject(ArtemisNavigationUtilService);
    private readonly alertService = inject(AlertService);
    private readonly profileService = inject(ProfileService);
    private readonly fb = inject(FormBuilder);
    private readonly accountService = inject(AccountService);

    protected readonly faBan = faBan;
    protected readonly faSave = faSave;

    /** Controls visibility of the declarative organization-selector dialog. */
    readonly orgSelectorVisible = signal(false);

    private readonly findLanguageFromKeyPipe = new FindLanguageFromKeyPipe();

    /** Validation constants */
    readonly USERNAME_MIN_LENGTH = USERNAME_MIN_LENGTH;
    readonly USERNAME_MAX_LENGTH = USERNAME_MAX_LENGTH;
    readonly PASSWORD_MIN_LENGTH = PASSWORD_MIN_LENGTH;
    readonly PASSWORD_MAX_LENGTH = PASSWORD_MAX_LENGTH;
    readonly EMAIL_MIN_LENGTH = 5;
    readonly EMAIL_MAX_LENGTH = 100;
    readonly REGISTRATION_NUMBER_MAX_LENGTH = 20;

    /** The user being edited. Signal so async mutations (route resolver data, organizations fetched via HTTP) render under zoneless. */
    readonly user = signal<User>(undefined!);

    /** Available languages for selection */
    readonly languages = signal<string[]>(undefined!);

    /** Language options ({ label, value }) derived for the PrimeNG select. */
    readonly languageOptions = computed(() => (this.languages() ?? []).map((language) => ({ label: this.findLanguageFromKeyPipe.transform(language), value: language })));

    /** Whether a random password should be generated (new users) or the old password kept (existing users). */
    readonly useRandomPassword = signal(true);

    /** Available authorities for selection */
    readonly authorities = signal<string[]>([]);

    /** Sorted authorities by role hierarchy (super admin > admin > instructor > editor > tutor) */
    readonly sortedAuthorities = computed(() => {
        const roleOrder: Record<string, number> = {
            ROLE_SUPER_ADMIN: 0,
            ROLE_ADMIN: 1,
            ROLE_INSTRUCTOR: 2,
            ROLE_EDITOR: 3,
            ROLE_TA: 4,
            ROLE_USER: 5,
        };
        return [...this.authorities()].sort((a, b) => {
            const orderA = roleOrder[a] ?? 999;
            const orderB = roleOrder[b] ?? 999;
            return orderA - orderB;
        });
    });

    /** Whether the form is currently being submitted */
    readonly isSaving = signal(false);
    /** Authority to translation key mapping */
    private readonly authorityTranslationKeys: Record<string, string> = {
        ROLE_SUPER_ADMIN: 'artemisApp.userManagement.roles.superAdmin',
        ROLE_ADMIN: 'artemisApp.userManagement.roles.admin',
        ROLE_INSTRUCTOR: 'artemisApp.userManagement.roles.instructor',
        ROLE_EDITOR: 'artemisApp.userManagement.roles.editor',
        ROLE_TA: 'artemisApp.userManagement.roles.tutor',
        ROLE_USER: 'artemisApp.userManagement.roles.user',
    };

    /** The reactive form for editing user properties */
    editForm!: FormGroup; // initialized in ngOnInit() via initializeForm()

    /** Original login for detecting, changes */
    private oldLogin?: string;

    /** Whether Jenkins profile is active */
    private isJenkins = false;

    /**
     * Initializes the component by loading user data, authorities and languages.
     */
    ngOnInit(): void {
        // create a new user, and only overwrite it if we fetch a user to edit
        this.user.set(new User());
        this.route.parent!.data.subscribe(({ user }) => {
            if (user) {
                this.user.set(user.body ? user.body : user);
                this.oldLogin = this.user().login;
                this.organizationService.getOrganizationsByUser(this.user().id!).subscribe((organizations) => {
                    // Rebuild the user reference so the async organization update renders under zoneless.
                    this.user.update((currentUser) => ({ ...currentUser, organizations }));
                });
            }
        });
        this.isJenkins = this.profileService.isProfileActive(PROFILE_JENKINS);
        this.userService.authorities().subscribe((authorities) => {
            this.authorities.set(
                this.accountService.isSuperAdmin() ? authorities : authorities.filter((authority) => authority !== Authority.SUPER_ADMIN && authority !== Authority.ADMIN),
            );
        });
        this.languages.set(this.languageHelper.getAll());
        // Set password to undefined. ==> If it still is undefined on save, it won't be changed for existing users. It will be random for new users
        this.user().password = undefined;
        this.initializeForm();
    }

    /**
     * Navigate to the previous page when the user cancels the update process
     * Returns to the detail page if there is no previous state, and we edited an existing user
     * Returns to the overview page if there is no previous state, and we created a new user
     */
    previousState() {
        if (this.user().id) {
            this.navigationUtilService.navigateBack(['admin', 'user-management', this.user().login!.toString()]);
        } else {
            this.navigationUtilService.navigateBack(['admin', 'user-management']);
        }
    }

    /**
     * Saves the user (creates new or updates existing).
     * Blocks submission (without disabling the button) if the email fails any of the custom
     * checks below, rendering the messages inline under the email field (same text-state-danger
     * styling as the other field validators) instead of as page-level alerts.
     */
    save(): void {
        /** Removes all displayed error messages when I click the Save button again */
        this.alertService.closeAll();
        
        const emailValue = this.editForm.get('email')?.value ?? '';
        /** Prints appropriate error message when the email address contains consecutive periods */
        if (this.hasConsecutivePeriods(emailValue)) {
            this.alertService.addAlert({
                type: AlertType.DANGER,
                message: 'Error: The email address must not contain consecutive periods.',
                disableTranslation: true,
            });
            this.editForm.get('email')?.markAsDirty();
        }
        /** Prints appropriate error message when the email address doesn't contain 
         * exactly one "@" symbol 
         */
        if (!this.hasSingleAtSymbol(emailValue)) {
            this.alertService.addAlert({
                type: AlertType.DANGER,
                message: 'Error: The email address must contain exactly one "@" symbol.',
                disableTranslation: true,
            });
            this.editForm.get('email')?.markAsDirty();
            return;
        } else {
            /** Prints appropriate error message when the email address doesn't contain a username */
            if (!this.hasUsername(emailValue)) {
                this.alertService.addAlert({
                    type: AlertType.DANGER,
                    message: 'Error: The email address must contain a username.',
                    disableTranslation: true,
                });
                this.editForm.get('email')?.markAsDirty();
            } else {
                /** Prints appropriate error message when the username starts with a period */
                if (this.usernameStartsWithPeriod(emailValue)) {
                    this.alertService.addAlert({
                        type: AlertType.DANGER,
                        message: 'Error: The username must not start with a period.',
                        disableTranslation: true,
                    });
                    this.editForm.get('email')?.markAsDirty();
                }
                /** Prints appropriate error message when the username ends with a period */
                if (this.usernameEndsWithPeriod(emailValue)) {
                    this.alertService.addAlert({
                        type: AlertType.DANGER,
                        message: 'Error: The username must not end with a period.',
                        disableTranslation: true,
                    });
                    this.editForm.get('email')?.markAsDirty();
                }
            }
            /** Prints appropriate error message when the email address doesn't 
             * contain a domain name 
             */
            if (!this.hasDomainName(emailValue)) {
                this.alertService.addAlert({
                    type: AlertType.DANGER,
                    message: 'Error: The email address must contain a domain name.',
                    disableTranslation: true,
                });
                this.editForm.get('email')?.markAsDirty();
            } else {
                /** Prints appropriate error message when the domain name starts with a period */
                if (this.domainStartsWithPeriod(emailValue)) {
                    this.alertService.addAlert({
                        type: AlertType.DANGER,
                        message: 'Error: The domain must not start with a period.',
                        disableTranslation: true,
                    });
                    this.editForm.get('email')?.markAsDirty();
                }
                /** Prints appropriate error message when the domain name ends with a period */
                if (this.domainEndsWithPeriod(emailValue)) {
                    this.alertService.addAlert({
                        type: AlertType.DANGER,
                        message: 'Error: The domain must not end with a period.',
                        disableTranslation: true,
                    });
                    this.editForm.get('email')?.markAsDirty();
                }
                /** Prints appropriate error message when at least one domain label
                 *  starts with a hyphen 
                 */
                if (this.domainLabelStartsWithHyphen(emailValue)) {
                    this.alertService.addAlert({
                        type: AlertType.DANGER,
                        message: 'Error: Domain labels must not start with a hyphen (-).',
                        disableTranslation: true,
                    });
                    this.editForm.get('email')?.markAsDirty();
                }
                /** Prints appropriate error message when at least one domain label
                 *  ends with a hyphen 
                 */
                if (this.domainLabelEndsWithHyphen(emailValue)) {
                    this.alertService.addAlert({
                        type: AlertType.DANGER,
                        message: 'Error: Domain labels must not end with a hyphen (-).',
                        disableTranslation: true,
                    });
                    this.editForm.get('email')?.markAsDirty();
                }
            }
        }
        /** Doesn't save the email address if at least one of the errors covered above occurs */
        if (
            this.hasConsecutivePeriods(emailValue) ||
            !this.hasUsername(emailValue) ||
            this.usernameStartsWithPeriod(emailValue) ||
            this.usernameEndsWithPeriod(emailValue) ||
            !this.hasDomainName(emailValue) ||
            this.domainStartsWithPeriod(emailValue) ||
            this.domainEndsWithPeriod(emailValue) ||
            this.domainLabelStartsWithHyphen(emailValue) ||
            this.domainLabelEndsWithHyphen(emailValue)
        ) {
            return;
        }
    
        this.isSaving.set(true);
        // temporarily store the user organizations because they are not part of the edit form
        const userOrganizations = this.user().organizations;
        const updatedUser: User = this.editForm.getRawValue();
        updatedUser.organizations = userOrganizations;
        this.user.set(updatedUser);
        if (updatedUser.id) {
            this.userService.update(updatedUser).subscribe({
                next: () => {
                    if (this.isJenkins && updatedUser.login !== this.oldLogin && !updatedUser.password) {
                        this.alertService.addAlert({
                            type: AlertType.WARNING,
                            message: 'artemisApp.userManagement.jenkinsChange',
                            timeout: 0,
                            translationParams: { oldLogin: this.oldLogin, newLogin: updatedUser.login },
                        });
                    }
                    this.onSaveSuccess();
                },
                error: () => this.onSaveError(),
            });
        } else {
            this.userService.create(updatedUser).subscribe({
                next: () => this.onSaveSuccess(),
                error: () => this.onSaveError(),
            });
        }
    }

    shouldRandomizePassword(useRandomPassword: boolean) {
        this.useRandomPassword.set(useRandomPassword);
        this.user().password = useRandomPassword ? undefined : '';
    }

    /**
     * Opens the organizations modal used to select an organization to add
     */
    openOrganizationsModal() {
        this.orgSelectorVisible.set(true);
    }

    /**
     * Adds the organization chosen in the selector dialog to the user.
     * @param organization the organization selected in the dialog
     */
    onOrgSelected(organization: Organization) {
        // Rebuild the user reference (new organizations array) so the dialog result renders under zoneless.
        this.user.update((currentUser) => ({ ...currentUser, organizations: [...(currentUser.organizations ?? []), organization] }));
    }

    /**
     * Removes an organization from the user
     * @param organization to remove
     */
    removeOrganizationFromUser(organization: Organization) {
        // Rebuild the user reference (new organizations array) so the updated list renders under zoneless.
        this.user.update((currentUser) => ({ ...currentUser, organizations: currentUser.organizations!.filter((userOrganization) => userOrganization.id !== organization.id) }));
    }

    private initializeForm() {
        if (this.editForm) {
            return;
        }
        this.editForm = this.fb.group({
            id: ['', []],
            login: ['', [Validators.required, Validators.minLength(USERNAME_MIN_LENGTH), Validators.maxLength(USERNAME_MAX_LENGTH)]],
            firstName: ['', [Validators.required, Validators.maxLength(USERNAME_MAX_LENGTH)]],
            lastName: ['', [Validators.required, Validators.maxLength(USERNAME_MAX_LENGTH)]],
            password: ['', [Validators.minLength(PASSWORD_MIN_LENGTH), Validators.maxLength(PASSWORD_MAX_LENGTH)]],
            email: ['', [Validators.required, Validators.minLength(this.EMAIL_MIN_LENGTH), Validators.maxLength(this.EMAIL_MAX_LENGTH)]],
            visibleRegistrationNumber: ['', [Validators.maxLength(this.REGISTRATION_NUMBER_MAX_LENGTH)]],
            activated: [''],
            isTestUser: [''],
            langKey: [''],
            authorities: [''],
            internal: [{ disabled: true }], // initially disabled, will be enabled if user.id is undefined
        });
        // Conditionally enable or disable 'internal' input based on user.id
        if (this.user().id !== undefined) {
            this.editForm.get('internal')?.disable(); // Artemis does not support to edit the internal flag for existing users
        } else {
            this.editForm.get('internal')?.enable(); // New users can either be internal or external
        }
        this.editForm.patchValue(this.user());
    }

    /**
     * Handles successful save by resetting state and navigating to previous page.
     */
    private onSaveSuccess(): void {
        this.isSaving.set(false);
        this.previousState();
    }

    /**
     * Handles save error by resetting the saving state.
     */
    private onSaveError(): void {
        this.isSaving.set(false);
    }

    /**
     * Get the translation key for an authority
     * @param authority the authority string (e.g., ROLE_ADMIN)
     */
    getAuthorityTranslationKey(authority: string): string {
        return this.authorityTranslationKeys[authority] ?? authority;
    }

    /**
     * Check if the user has a specific authority
     * @param authority the authority to check
     */
    hasAuthority(authority: string): boolean {
        const authorities = this.editForm.get('authorities')?.value;
        return Array.isArray(authorities) && authorities.includes(authority);
    }

    /**
     * Toggle an authority on or off for the user
     * @param authority the authority to toggle
     */
    toggleAuthority(authority: string): void {
        const authoritiesControl = this.editForm.get('authorities');
        const currentAuthorities: string[] = authoritiesControl?.value ?? [];

        if (currentAuthorities.includes(authority)) {
            authoritiesControl?.setValue(currentAuthorities.filter((a) => a !== authority));
        } else {
            authoritiesControl?.setValue([...currentAuthorities, authority]);
        }
    }

    /**
     * Checks whether an email address contains exactly one "@" symbol.
     * Empty and null email addresses are treated as valid here;
     * `Validators.required` on the control is the single source of truth
     * for emptiness, so this check only concerns itself with the "@" count.
     * @param value the email address to check
     */
    private hasSingleAtSymbol(value: string): boolean {
        if (value == null || value === '') {
            return true;
        }
        const firstIndex = value.indexOf('@');
        const lastIndex = value.lastIndexOf('@');
        return firstIndex !== -1 && firstIndex === lastIndex;
    }

    /**
     * Checks whether an email address contains a domain name.
     * Empty and null email addresses are treated as valid here;
     * `Validators.required` on the control is the single source of truth
     * for emptiness, so this check only concerns itself with whether the
     * email address contains a domain name.
     * @param value the email address to check
     */
    private hasDomainName(value: string): boolean {
        if (value == null || value === '') {
            return true;
        }
        return value.substring(value.indexOf('@') + 1).replace(/\s+/g, '').length > 0;
    }
    /**
     * Checks whether an email address contains a username.
     * Empty and null email addresses are treated as valid here;
     * `Validators.required` on the control is the single source of truth
     * for emptiness, so this check only concerns itself with whether the
     * email address contains a username.
     * @param value the email address to check
     */
    private hasUsername(value: string): boolean {
        if (value == null || value === '') {
            return true;
        }
        return value.substring(0, value.indexOf('@')).replace(/\s+/g, '').length > 0;
    }
    /**
     * Checks whether the domain name starts with a period.
     * Empty and null email addresses are treated as valid here;
     * `Validators.required` on the control is the single source of truth
     * for emptiness, so this check only concerns itself with whether the
     * domain name starts with a period.
     * @param value the email address to check
     */
    private domainStartsWithPeriod(value: string): boolean {
        if (value == null || value === '') {
            return true;
        }
        const domain = value.substring(value.indexOf('@') + 1);
        return domain.startsWith('.') == true;
    }
    /**
     * Checks whether the domain name ends with a period.
     * Empty and null email addresses are treated as valid here;
     * `Validators.required` on the control is the single source of truth
     * for emptiness, so this check only concerns itself with whether the
     * domain name ends with a period.
     * @param value the email address to check
     */
    private domainEndsWithPeriod(value: string): boolean {
        if (value == null || value === '') {
            return true;
        }
        return value.endsWith('.') == true;
    }
    /**
     * Checks whether the username starts with a period.
     * Empty and null email addresses are treated as valid here;
     * `Validators.required` on the control is the single source of truth
     * for emptiness, so this check only concerns itself with whether the
     * username starts with a period.
     * @param value the email address to check
     */
    private usernameStartsWithPeriod(value: string): boolean {
        if (value == null || value === '') {
            return true;
        }
        const username = value.substring(0, value.indexOf('@'));
        return username.startsWith('.') == true;
    }
    /**
     * Checks whether the username ends with a period.
     * Empty and null email addresses are treated as valid here;
     * `Validators.required` on the control is the single source of truth
     * for emptiness, so this check only concerns itself with whether the
     * username ends with a period.
     * @param value the email address to check
     */
    private usernameEndsWithPeriod(value: string): boolean {
        if (value == null || value === '') {
            return true;
        }
        const username = value.substring(0, value.indexOf('@'));
        return username.endsWith('.') == true;
    }
    /**
     * Checks whether the email address contains consecutive periods.
     * Empty and null email addresses are treated as valid here;
     * `Validators.required` on the control is the single source of truth
     * for emptiness, so this check only concerns itself with whether the
     * email address contains consecutive periods.
     * @param value the email address to check
     */
    private hasConsecutivePeriods(value: string): boolean {
        if (value == null || value === '') {
            return true;
        }
        return value.includes('..') == true;
    }
    /**
     * Checks whether at least one domain label starts with a hyphen.
     * Empty and null email addresses are treated as valid here;
     * `Validators.required` on the control is the single source of truth
     * for emptiness, so this check only concerns itself with whether
     * at least one domain label starts with a hyphen.
     * @param value the email address to check
     */
    private domainLabelStartsWithHyphen(value: string): boolean {
        if (value == null || value === '') {
            return true;
        }
        const domainLabels = this.getDomainLabels(value);
        return domainLabels.some((label) => label.startsWith('-'));
    }
    /**
     * Checks whether at least one domain label ends with a hyphen.
     * Empty and null email addresses are treated as valid here;
     * `Validators.required` on the control is the single source of truth
     * for emptiness, so this check only concerns itself with whether
     * at least one domain label ends with a hyphen.
     * @param value the email address to check
     */
    private domainLabelEndsWithHyphen(value: string): boolean {
        if (value == null || value === '') {
            return true;
        }
        const domainLabels = this.getDomainLabels(value);
        return domainLabels.some((label) => label.endsWith('-'));
    }
    /**
     * Returns an array of all the domain labels of an email address.
     * @param value the email address
     */
    private getDomainLabels(value: string): string[] {
        const domain = value.substring(value.indexOf('@') + 1);
        return domain.split('.');
    }
}